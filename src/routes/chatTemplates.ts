import express from 'express';
import {
    createChatTemplate,
    deleteChatTemplate,
    getChatTemplates,
    updateChatTemplate,
} from '../controllers/chatTemplate';

const router = express.Router();

router.get('/', getChatTemplates);
router.post('/', createChatTemplate);
router.put('/:id', updateChatTemplate);
router.delete('/:id', deleteChatTemplate);

export default router;
