require('dotenv').config();

const bcrypt = require('bcrypt');
const pool = require('./db');

async function provisionAdmin() {
    const email = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.INITIAL_ADMIN_PASSWORD || '';
    const fullName = (process.env.INITIAL_ADMIN_NAME || 'Administrator').trim();

    if (!email || !password || password.length < 8 || password.length > 72 || !fullName) {
        throw new Error('Set INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD (8-72 characters), and optionally INITIAL_ADMIN_NAME.');
    }

    const [existing] = await pool.execute(
        'SELECT user_id, role FROM users WHERE email = ?',
        [email]
    );
    if (existing.length > 0) {
        throw new Error('An account with this email already exists. No account was changed.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.execute(
        `INSERT INTO users (full_name, email, password_hash, role, account_status)
         VALUES (?, ?, ?, 'admin', 'active')`,
        [fullName, email, passwordHash]
    );
    console.log(`Provisioned admin account for ${email}.`);
}

provisionAdmin()
    .catch(error => {
        console.error(`Admin provisioning failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
