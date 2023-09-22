import speakeasy from 'speakeasy';
import Mailgun from 'mailgun.js';
import formData from 'form-data';

export function generateOTPSecret(): string {
    const secret = speakeasy.generateSecret();
    return secret.base32;
}

export function generateOTPToken(secret: string): string {
    const token = speakeasy.totp({
        secret: secret,
        encoding: 'base32',
    });
    return token;
}

export function verifyOTPToken(secret: string, token: string): boolean {
    const isValid = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: token,
        window: 1,
    });
    return isValid;
}

export async function sendEmail(toEmail: string, otpToken: string, subject: string) {
    const mailgun = new Mailgun(formData);
    const mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY! });
    const data = {
        from: 'amrizing@gmail.com',
        // to: toEmail,
        to: 'amrimuvti@gmail.com',
        subject: subject,
        text: `Here's your OTP: ${otpToken}`,
    };

    try {
        await mg.messages.create(process.env.MAILGUN_DOMAIN!, data);
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}
