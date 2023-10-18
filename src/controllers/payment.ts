/* eslint-disable @typescript-eslint/no-explicit-any */
import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import axios from 'axios';
import moment from 'moment-timezone';

export const pay: RequestHandler = async (req, res) => {
    try {
        const url = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
        const apiKey = process.env.MIDTRANS_KEY!;
        const user = req.prismaUser;

        const { subscriptionId, subscriptionType } = req.body;

        const subscription = await prisma.subscription.findUnique({
            where: { id: subscriptionId },
        });

        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found' });
        }

        const paidPrice =
            subscriptionType == 'monthly' ? subscription?.monthlyPrice : subscription?.yearlyPrice;

        if (paidPrice === null || paidPrice === undefined) {
            return res.status(400).json({ error: 'Invalid subscriptionType' });
        }

        const order_id = `ORDER-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        const start_time = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss ZZ');

        const requestBody = {
            transaction_details: {
                order_id,
                gross_amount: paidPrice,
            },
            item_details: [
                {
                    id: subscriptionId,
                    price: paidPrice,
                    quantity: 1,
                    name: subscription?.name,
                    brand: 'Forwardin',
                    category: 'Subscription',
                    merchant_name: 'Forwardin',
                },
            ],
            customer_details: {
                first_name: user.firstName,
                last_name: user.lastName,
                email: user.email,
                phone: user.phone,
                billing_address: {
                    first_name: user.firstName,
                    last_name: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    address: 'Sudirman',
                    city: 'Jakarta',
                    postal_code: '12190',
                    country_code: 'IDN',
                },
                shipping_address: {
                    first_name: user.firstName,
                    last_name: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    address: 'Sudirman',
                    city: 'Jakarta',
                    postal_code: '12190',
                    country_code: 'IDN',
                },
            },
            enabled_payments: [
                'credit_card',
                'mandiri_clickpay',
                'cimb_clicks',
                'bca_klikbca',
                'bca_klikpay',
                'bri_epay',
                'echannel',
                'mandiri_ecash',
                'permata_va',
                'bca_va',
                'bni_va',
                'other_va',
                'gopay',
                'indomaret',
                'alfamart',
                'danamon_online',
                'akulaku',
            ],
            credit_card: {
                secure: true,
                bank: 'bca',
                installment: {
                    required: false,
                    terms: {
                        bni: [3, 6, 12],
                        mandiri: [3, 6, 12],
                        cimb: [3],
                        bca: [3, 6, 12],
                        offline: [6, 12],
                    },
                },
                whitelist_bins: ['48111111', '41111111'],
            },
            bca_va: {
                va_number: '12345678911',
                sub_company_code: '00000',
                free_text: {
                    inquiry: [
                        {
                            en: 'text in English',
                            id: 'text in Bahasa Indonesia',
                        },
                    ],
                    payment: [
                        {
                            en: 'text in English',
                            id: 'text in Bahasa Indonesia',
                        },
                    ],
                },
            },
            bni_va: {
                va_number: '12345678',
            },
            permata_va: {
                va_number: '1234567890',
                recipient_name: 'SUDARSONO',
            },
            callbacks: {
                finish: 'https://forwardin.adslink.id',
            },
            expiry: {
                start_time,
                unit: 'minutes',
                duration: 10,
            },
            custom_field1: user.id,
            custom_field2: subscriptionId,
        };

        logger.warn(requestBody);
        const config = {
            headers: {
                Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
                'Content-Type': 'application/json',
            },
        };

        const response = await axios.post(url, requestBody, config);
        res.status(200).json(response.data);
    } catch (error: any) {
        logger.error('Payment failed:', error);
        res.status(500).json({ error: 'Payment failed', details: error.message });
    }
};

export const handleNotification: RequestHandler = async (req, res) => {
    try {
        const {
            order_id,
            transaction_id,
            transaction_time,
            gross_amount,
            custom_field1,
            custom_field2,
        } = req.body;

        if (
            !order_id ||
            !transaction_id ||
            !transaction_time ||
            !gross_amount ||
            !custom_field1 ||
            !custom_field2
        ) {
            return res.status(400).json({ error: 'Invalid notification data' });
        }

        const transaction_time_iso = new Date(transaction_time).toISOString();

        const user = await prisma.user.findUnique({
            where: { id: custom_field1 },
        });

        const subscription = await prisma.subscription.findUnique({
            where: { id: custom_field2 },
        });

        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found' });
        }

        if (user) {
            await prisma.transaction.upsert({
                where: { id: transaction_id },
                create: {
                    name: order_id,
                    id: transaction_id,
                    paidPrice: gross_amount,
                    userId: user.pkId,
                    subscriptionId: subscription.pkId,
                    createdAt: transaction_time_iso,
                },
                update: {
                    updatedAt: transaction_time_iso,
                },
            });
            return res.status(200).json({ message: 'Transaction created successfully' });
        } else {
            return res.status(500).json({ error: 'Failed to create or update transaction' });
        }
    } catch (error) {
        const message = 'An error occured during payment notification handling';
        logger.error(error, message);
        res.status(500).json({ error: message });
    }
};

export const getSubscriptions: RequestHandler = async (req, res) => {
    try {
        const subscriptions = await prisma.subscription.findMany({
            where: { isAvailable: true },
            select: {
                id: true,
                name: true,
                monthlyPrice: true,
                yearlyPrice: true,
            },
        });
        res.status(200).json(subscriptions);
    } catch (error) {
        res.status(500).json(error);
    }
};

export const getSubscription: RequestHandler = async (req, res) => {
    try {
        const subscriptionId = req.params.subscriptionId;

        const subscription = await prisma.subscription.findMany({
            where: { isAvailable: true, id: subscriptionId },
            select: {
                id: true,
                name: true,
                monthlyPrice: true,
                yearlyPrice: true,
            },
        });
        res.status(200).json(subscription);
    } catch (error) {
        res.status(500).json(error);
    }
};

export const getTransactions: RequestHandler = async (req, res) => {
    try {
        const userId = req.prismaUser.pkId;

        const transactions = await prisma.transaction.findMany({
            where: { userId },
        });
        res.status(200).json(transactions);
    } catch (error) {
        res.status(500).json(error);
    }
};
