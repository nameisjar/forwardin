import speakeasy from 'speakeasy';
// import Mailgun from 'mailgun.js';
// import formData from 'form-data';
import nodemailer from 'nodemailer';

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
    // const mailgun = new Mailgun(formData);
    // const mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY! });
    // const data = {
    //     from: 'amrizing@gmail.com',
    //     // to: toEmail,
    //     to: 'amrimuvti@gmail.com',
    //     subject: subject,
    //     text: `Here's your OTP: ${otpToken}`,
    // };

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.NODEMAILER_EMAIL,
            pass: process.env.NODEMAILER_PASSWORD,
        },
        tls: { rejectUnauthorized: false },
    });

    try {
        await transporter.sendMail({
            from: process.env.NODEMAILER_EMAIL,
            to: toEmail,
            subject: subject,
            text: `Here's your OTP: ${otpToken}`,
        });

        // await mg.messages.create(process.env.MAILGUN_DOMAIN!, data);
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}
