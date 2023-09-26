import { RequestHandler } from 'express';
import { validationResult, body } from 'express-validator';

export const passwordRules = body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .custom((value: string) => {
        const lowercaseRegex = /[a-z]/;
        const uppercaseRegex = /[A-Z]/;
        const numberRegex = /[0-9]/;
        const specialCharRegex = /[!@#$%^&*()_+[\]{};':"\\|,.<>/?]+/;

        const characterTypesCount = [
            lowercaseRegex.test(value),
            uppercaseRegex.test(value),
            numberRegex.test(value),
            specialCharRegex.test(value),
        ].filter((isPresent) => isPresent).length;

        if (characterTypesCount >= 3) {
            return true;
        }

        throw new Error(
            'Password must contain at least three of the following: lowercase letters, uppercase letters, numbers, or special characters',
        );
    });

export const emailRules = body('email').isEmail().withMessage('Invalid email address');

export const registerValidationRules = [
    body('username')
        .isLength({ min: 5 })
        .withMessage('Username must be at least 5 characters long'),
    body('phone').isMobilePhone('any', { strictMode: false }).withMessage('Invalid phone number'),
    emailRules,
    passwordRules,
];

export const dateRules = body('dob').isDate().withMessage('Invalid date format');

export const validate: RequestHandler = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    next();
};
