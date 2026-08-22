import logger from '../config/logger';
import { getJid, verifyJid } from '../whatsapp';
import { sendDocumentMessage } from './messageSender';
import { canDeviceSend, recordRateLimitWithError } from './signalDetector';
import type { RateLimitResult } from './rateLimiter';
import { redactPhone } from '../utils/logRedaction';
import { persistGeneratedMediaBuffer } from './generatedMediaStorage';

type WhatsAppSession = Parameters<typeof verifyJid>[0];

export interface MonthlyFeedbackRecipient {
    phone: string;
    studentName: string;
}

export interface MonthlyFeedbackDocument {
    buffer: Buffer;
    fileName: string;
    caption: string;
}

export type MonthlyFeedbackSendStatus = 'success' | 'failed' | 'paused';

export interface MonthlyFeedbackSendResult {
    recipient: string;
    normalizedRecipient?: string;
    studentName: string;
    status: MonthlyFeedbackSendStatus;
    error?: string;
    rateLimitInfo?: RateLimitResult;
}

export interface MonthlyFeedbackBatchResult {
    results: MonthlyFeedbackSendResult[];
    total: number;
    success: number;
    failed: number;
    paused: number;
    invalid: number;
    duplicatesRemoved: number;
    stoppedReason?: string;
}

interface PreparedRecipient extends MonthlyFeedbackRecipient {
    inputIndex: number;
    normalizedPhone: string;
    jid: string;
}

interface MonthlyFeedbackBatchOptions {
    session: WhatsAppSession;
    deviceUuid: string;
    devicePkId: number;
    recipients: MonthlyFeedbackRecipient[];
    createDocument: (recipient: MonthlyFeedbackRecipient) => Promise<MonthlyFeedbackDocument>;
    pdfConcurrency?: number;
}

const monthlyFeedbackDeviceTails = new Map<string, Promise<void>>();

function envNumber(name: string, fallback: number, minimum = 0): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function randomInteger(min: number, max: number): number {
    const lower = Math.ceil(Math.min(min, max));
    const upper = Math.floor(Math.max(min, max));
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize Monthly Feedback batches per device. This lock is deliberately
 * local to this feature; actual sends still use messageSender's shared queue.
 */
async function withMonthlyFeedbackDeviceLock<T>(
    deviceUuid: string,
    task: () => Promise<T>,
): Promise<T> {
    const previousTail = monthlyFeedbackDeviceTails.get(deviceUuid) || Promise.resolve();
    let releaseCurrent!: () => void;
    const currentGate = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
    });
    const currentTail = previousTail.catch(() => undefined).then(() => currentGate);

    monthlyFeedbackDeviceTails.set(deviceUuid, currentTail);
    await previousTail.catch(() => undefined);

    try {
        return await task();
    } finally {
        releaseCurrent();
        if (monthlyFeedbackDeviceTails.get(deviceUuid) === currentTail) {
            monthlyFeedbackDeviceTails.delete(deviceUuid);
        }
    }
}

/**
 * Normalize direct phone input to the same canonical form used by contacts.
 * LID recipients are retained because Baileys cannot validate them via onWhatsApp.
 */
export function normalizeMonthlyFeedbackPhone(rawPhone: unknown): {
    phone: string;
    jid: string;
} {
    const raw = String(rawPhone ?? '').trim();
    if (!raw) {
        throw new Error('Nomor penerima kosong');
    }

    if (/^\d+@lid$/i.test(raw)) {
        return { phone: raw.toLowerCase(), jid: raw.toLowerCase() };
    }

    if (raw.includes('@') && !/@s\.whatsapp\.net$/i.test(raw)) {
        throw new Error('Format penerima harus berupa nomor WhatsApp pribadi');
    }

    const withoutDomain = raw.replace(/@s\.whatsapp\.net$/i, '');
    let digits = withoutDomain.replace(/\D/g, '');

    if (digits.startsWith('0')) {
        digits = `62${digits.slice(1)}`;
    } else if (digits.startsWith('8')) {
        digits = `62${digits}`;
    }

    // E.164 permits at most 15 digits. Eight digits is a conservative lower bound.
    if (!/^\d{8,15}$/.test(digits)) {
        throw new Error('Nomor penerima tidak valid (harus 8-15 digit)');
    }

    return { phone: digits, jid: getJid(digits) };
}

function isRateLimitError(error: unknown): boolean {
    const message = String(error ?? '').toLowerCase();
    return (
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('slow down') ||
        message.includes('try again later')
    );
}

class MonthlyFeedbackDelay {
    private sendAttempts = 0;
    private nextCooldownAt: number;

    constructor(private readonly deviceUuid: string) {
        this.nextCooldownAt = randomInteger(
            envNumber('MONTHLY_FEEDBACK_CLUSTER_MIN', 3, 1),
            envNumber('MONTHLY_FEEDBACK_CLUSTER_MAX', 5, 1),
        );
    }

    async wait(): Promise<void> {
        const baseDelay = envNumber('MONTHLY_FEEDBACK_BASE_DELAY_MS', 5000, 1000);
        const jitterMin = envNumber('MONTHLY_FEEDBACK_JITTER_MIN', 0.7, 0.1);
        const jitterMax = envNumber('MONTHLY_FEEDBACK_JITTER_MAX', 1.4, jitterMin);
        const progressiveStart = envNumber('MONTHLY_FEEDBACK_PROGRESSIVE_START', 10, 1);
        const progressiveStep = envNumber('MONTHLY_FEEDBACK_PROGRESSIVE_STEP_MS', 500, 0);
        const progressiveCap = envNumber('MONTHLY_FEEDBACK_PROGRESSIVE_CAP_MS', 5000, 0);

        let cooldownMs = 0;
        if (this.sendAttempts > 0 && this.sendAttempts >= this.nextCooldownAt) {
            cooldownMs = randomInteger(
                envNumber('MONTHLY_FEEDBACK_COOLDOWN_MIN_MS', 10000, 0),
                envNumber('MONTHLY_FEEDBACK_COOLDOWN_MAX_MS', 20000, 0),
            );
            this.nextCooldownAt += randomInteger(
                envNumber('MONTHLY_FEEDBACK_CLUSTER_MIN', 3, 1),
                envNumber('MONTHLY_FEEDBACK_CLUSTER_MAX', 5, 1),
            );
        }

        const jitterMultiplier = jitterMin + Math.random() * (jitterMax - jitterMin);
        const progressiveBatches =
            this.sendAttempts >= progressiveStart
                ? Math.floor((this.sendAttempts - progressiveStart) / 5) + 1
                : 0;
        const progressiveMs = Math.min(progressiveCap, progressiveBatches * progressiveStep);
        const waitMs = Math.round(baseDelay * jitterMultiplier) + cooldownMs + progressiveMs;

        logger.info(
            {
                deviceId: this.deviceUuid,
                waitMs,
                cooldownMs,
                progressiveMs,
                attempt: this.sendAttempts + 1,
            },
            '[MonthlyFeedback] Applying isolated natural delay',
        );

        await sleep(waitMs);
        this.sendAttempts++;
    }
}

async function prepareRecipients(
    session: WhatsAppSession,
    recipients: MonthlyFeedbackRecipient[],
    verifyOnWhatsApp: boolean,
): Promise<{
    prepared: PreparedRecipient[];
    earlyResults: Array<{ inputIndex: number; result: MonthlyFeedbackSendResult }>;
    duplicatesRemoved: number;
    invalid: number;
}> {
    const prepared: PreparedRecipient[] = [];
    const earlyResults: Array<{ inputIndex: number; result: MonthlyFeedbackSendResult }> = [];
    const seen = new Set<string>();
    let duplicatesRemoved = 0;
    let invalid = 0;

    for (const [inputIndex, recipient] of recipients.entries()) {
        let normalized: { phone: string; jid: string };
        try {
            normalized = normalizeMonthlyFeedbackPhone(recipient.phone);
        } catch (error) {
            invalid++;
            earlyResults.push({
                inputIndex,
                result: {
                    recipient: String(recipient.phone ?? ''),
                    studentName: recipient.studentName,
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Nomor penerima tidak valid',
                },
            });
            continue;
        }

        if (seen.has(normalized.jid)) {
            duplicatesRemoved++;
            continue;
        }
        seen.add(normalized.jid);

        if (verifyOnWhatsApp) {
            try {
                await verifyJid(session, normalized.jid, 'number');
            } catch (error) {
                invalid++;
                logger.warn(
                    { recipient: redactPhone(normalized.phone), error },
                    '[MonthlyFeedback] Recipient is not registered on WhatsApp',
                );
                earlyResults.push({
                    inputIndex,
                    result: {
                        recipient: recipient.phone,
                        normalizedRecipient: normalized.phone,
                        studentName: recipient.studentName,
                        status: 'failed',
                        error: 'Nomor tidak terdaftar di WhatsApp atau tidak dapat diverifikasi',
                    },
                });
                continue;
            }
        }

        prepared.push({
            ...recipient,
            inputIndex,
            normalizedPhone: normalized.phone,
            jid: normalized.jid,
        });
    }

    return { prepared, earlyResults, duplicatesRemoved, invalid };
}

export async function sendMonthlyFeedbackBatch(
    options: MonthlyFeedbackBatchOptions,
): Promise<MonthlyFeedbackBatchResult> {
    return withMonthlyFeedbackDeviceLock(options.deviceUuid, async () => {
        const pdfConcurrency = Math.max(1, Math.min(options.pdfConcurrency || 3, 3));
        const maxConsecutiveFailures = envNumber('MONTHLY_FEEDBACK_MAX_CONSECUTIVE_FAILURES', 5, 1);
        const failureCooldownAfter = envNumber('MONTHLY_FEEDBACK_FAILURE_COOLDOWN_AFTER', 3, 1);
        const resultByIndex = new Map<number, MonthlyFeedbackSendResult>();
        const delay = new MonthlyFeedbackDelay(options.deviceUuid);
        let stoppedReason: string | undefined;
        let consecutiveFailures = 0;

        const initialHealth = await canDeviceSend(options.devicePkId);
        const { prepared, earlyResults, duplicatesRemoved, invalid } = await prepareRecipients(
            options.session,
            options.recipients,
            initialHealth.allowed,
        );
        for (const earlyResult of earlyResults) {
            resultByIndex.set(earlyResult.inputIndex, earlyResult.result);
        }

        if (!initialHealth.allowed) {
            stoppedReason = initialHealth.reason || 'Device tidak diizinkan mengirim';
        }

        for (
            let batchStart = 0;
            batchStart < prepared.length && !stoppedReason;
            batchStart += pdfConcurrency
        ) {
            const batch = prepared.slice(batchStart, batchStart + pdfConcurrency);
            const generated = await Promise.all(
                batch.map(async (recipient) => {
                    try {
                        const document = await options.createDocument(recipient);
                        return { recipient, document };
                    } catch (error) {
                        return { recipient, error };
                    }
                }),
            );

            for (const generatedItem of generated) {
                const recipient = generatedItem.recipient;
                if (stoppedReason) break;

                if ('error' in generatedItem) {
                    resultByIndex.set(recipient.inputIndex, {
                        recipient: recipient.phone,
                        normalizedRecipient: recipient.normalizedPhone,
                        studentName: recipient.studentName,
                        status: 'failed',
                        error:
                            generatedItem.error instanceof Error
                                ? generatedItem.error.message
                                : 'Gagal membuat PDF',
                    });
                    continue;
                }

                const healthBeforeDelay = await canDeviceSend(options.devicePkId);
                if (!healthBeforeDelay.allowed) {
                    stoppedReason = healthBeforeDelay.reason || 'Device tidak diizinkan mengirim';
                    break;
                }

                await delay.wait();

                // The device may have been paused while this task was waiting.
                const healthBeforeSend = await canDeviceSend(options.devicePkId);
                if (!healthBeforeSend.allowed) {
                    stoppedReason = healthBeforeSend.reason || 'Device tidak diizinkan mengirim';
                    break;
                }

                let persistedMediaPath: string | null = null;
                try {
                    persistedMediaPath = await persistGeneratedMediaBuffer(
                        options.deviceUuid,
                        generatedItem.document.buffer,
                        generatedItem.document.fileName,
                    );
                } catch (error) {
                    // A local Inbox copy is helpful, but its failure must not
                    // prevent an otherwise valid WhatsApp delivery.
                    logger.warn(
                        {
                            deviceId: options.deviceUuid,
                            recipient: redactPhone(recipient.normalizedPhone),
                            error,
                        },
                        '[MonthlyFeedback] Could not persist generated PDF for Inbox',
                    );
                }

                const sendResult = await sendDocumentMessage(
                    options.session,
                    options.deviceUuid,
                    recipient.jid,
                    generatedItem.document.buffer,
                    {
                        caption: generatedItem.document.caption,
                        fileName: generatedItem.document.fileName,
                        mimetype: 'application/pdf',
                        persistedMediaPath,
                    },
                );

                if (sendResult.success) {
                    consecutiveFailures = 0;
                    resultByIndex.set(recipient.inputIndex, {
                        recipient: recipient.phone,
                        normalizedRecipient: recipient.normalizedPhone,
                        studentName: recipient.studentName,
                        status: 'success',
                        rateLimitInfo: sendResult.rateLimitInfo,
                    });
                    continue;
                }

                consecutiveFailures++;
                const sendError = sendResult.error || 'Gagal mengirim dokumen';
                resultByIndex.set(recipient.inputIndex, {
                    recipient: recipient.phone,
                    normalizedRecipient: recipient.normalizedPhone,
                    studentName: recipient.studentName,
                    status: 'failed',
                    error: sendError,
                    rateLimitInfo: sendResult.rateLimitInfo,
                });

                if (isRateLimitError(sendError)) {
                    await recordRateLimitWithError(options.devicePkId, {
                        message: sendError,
                    }).catch((error) => {
                        logger.error(
                            { error, devicePkId: options.devicePkId },
                            '[MonthlyFeedback] Failed to record rate-limit signal',
                        );
                    });
                    stoppedReason = `Pengiriman dihentikan karena terdeteksi rate limit: ${sendError}`;
                    break;
                }

                if (consecutiveFailures >= maxConsecutiveFailures) {
                    stoppedReason = `Pengiriman dihentikan setelah ${consecutiveFailures} kegagalan beruntun`;
                    break;
                }

                if (consecutiveFailures === failureCooldownAfter) {
                    const cooldownMs = randomInteger(
                        envNumber('MONTHLY_FEEDBACK_FAILURE_COOLDOWN_MIN_MS', 30000, 0),
                        envNumber('MONTHLY_FEEDBACK_FAILURE_COOLDOWN_MAX_MS', 45000, 0),
                    );
                    logger.warn(
                        {
                            deviceId: options.deviceUuid,
                            consecutiveFailures,
                            cooldownMs,
                        },
                        '[MonthlyFeedback] Consecutive-failure cooldown',
                    );
                    await sleep(cooldownMs);
                }
            }
        }

        if (stoppedReason) {
            logger.warn(
                { deviceId: options.deviceUuid, stoppedReason },
                '[MonthlyFeedback] Batch paused by safety circuit breaker',
            );
            for (const recipient of prepared) {
                if (!resultByIndex.has(recipient.inputIndex)) {
                    resultByIndex.set(recipient.inputIndex, {
                        recipient: recipient.phone,
                        normalizedRecipient: recipient.normalizedPhone,
                        studentName: recipient.studentName,
                        status: 'paused',
                        error: stoppedReason,
                    });
                }
            }
        }

        const orderedResults = Array.from(resultByIndex.entries())
            .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
            .map(([, result]) => result);
        const success = orderedResults.filter((result) => result.status === 'success').length;
        const failed = orderedResults.filter((result) => result.status === 'failed').length;
        const paused = orderedResults.filter((result) => result.status === 'paused').length;

        return {
            results: orderedResults,
            total: orderedResults.length,
            success,
            failed,
            paused,
            invalid,
            duplicatesRemoved,
            stoppedReason,
        };
    });
}
