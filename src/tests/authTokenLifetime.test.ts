import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken } from '../utils/jwtGenerator';

describe('Authentication token lifetime', () => {
    const account = {
        id: 'account-id',
        email: 'account@example.com',
    };

    it('keeps access tokens short-lived', () => {
        const payload = jwt.decode(generateAccessToken(account)) as jwt.JwtPayload;

        expect(payload.exp).to.be.a('number');
        expect(payload.iat).to.be.a('number');
        expect(payload.exp! - payload.iat!).to.equal(60 * 60);
    });

    it('creates refresh tokens without an automatic expiry', () => {
        const payload = jwt.decode(generateRefreshToken(account)) as jwt.JwtPayload;

        expect(payload.id).to.equal(account.id);
        expect(payload.exp).to.equal(undefined);
    });
});
