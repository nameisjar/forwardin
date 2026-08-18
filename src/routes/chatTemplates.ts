import express from 'express';
import {
    createChatTemplate,
    deleteChatTemplate,
    getChatTemplates,
    importChatTemplates,
    updateChatTemplate,
} from '../controllers/chatTemplate';

const router = express.Router();

router.get('/', getChatTemplates);
router.post('/', createChatTemplate);
router.post('/import', importChatTemplates);
router.put('/:id', updateChatTemplate);
router.delete('/:id', deleteChatTemplate);

export default router;
