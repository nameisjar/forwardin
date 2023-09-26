import { RequestHandler } from 'express';
import prisma from '../utils/db';

// back here: add labels
export const createContact: RequestHandler = async (req, res) => {
    try {
        const { firstName, lastName, phone, email, gender, dob } = req.body;

        const existingContact = await prisma.contact.findFirst({
            where: {
                OR: [{ email: email }, { phone: phone }],
            },
        });

        if (existingContact) {
            return res
                .status(400)
                .json({ message: 'Contact with this email or phone number already exists' });
        }

        await prisma.contact.create({
            data: {
                firstName,
                lastName,
                phone,
                email,
                gender,
                dob: new Date(dob),
            },
        });

        res.status(200).json({ message: 'Contact created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getContacts: RequestHandler = async (req, res) => {
    try {
        const contacts = await prisma.contact.findMany();
        res.status(200).json(contacts);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: display group, history, and media
export const getContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const contact = await prisma.contact.findUnique({
            where: {
                id: contactId,
            },
        });

        if (!contact) {
            res.status(404).json({ message: 'Contact not found' });
        }

        res.status(200).json(contact);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const { firstName, lastName, phone, email, gender, dob } = req.body;

        const existingContact = await prisma.contact.findUnique({
            where: {
                id: contactId,
            },
        });

        if (!existingContact) {
            return res.status(404).json({ message: 'Contact nout found' });
        }

        await prisma.contact.update({
            where: {
                id: existingContact.id,
            },
            data: {
                firstName,
                lastName,
                phone,
                email,
                gender,
                dob: new Date(dob),
            },
        });

        res.status(200).json({ message: 'Contact updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;

        const existingContact = await prisma.contact.findUnique({
            where: {
                id: contactId,
            },
        });

        if (!existingContact) {
            return res.status(404).json({ message: 'Contact not found' });
        }

        await prisma.contact.delete({
            where: {
                id: contactId,
            },
        });

        res.status(200).json({ message: 'Contact deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
