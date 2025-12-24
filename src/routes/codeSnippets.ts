import express from 'express';
import * as controller from '../controllers/codeSnippet';

const router = express.Router();

// Protected routes (require auth)
router.post('/', controller.createSnippet);
router.get('/', controller.getSnippets);
router.get('/stats', controller.getSnippetStats);
router.get('/:id', controller.getSnippetById);
router.put('/:id', controller.updateSnippet);
router.delete('/', controller.deleteSnippets);
router.post('/:id/regenerate-token', controller.regenerateShareToken);

export default router;
