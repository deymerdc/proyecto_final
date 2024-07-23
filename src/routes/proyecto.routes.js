import { Router } from 'express';
const router = Router();

router.get('/', (req, res) => {
    res.redirect('index.html');
});

export default router;
