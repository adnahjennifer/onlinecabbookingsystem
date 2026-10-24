
const pool = require('./backend/db');

async function testConnection() {
    try {
        const [rows] = await pool.query(`
            SELECT
                DATABASE() AS database_name,
                VERSION() AS mysql_version,
                CURRENT_USER() AS authenticated_user
        `);

        console.log('Database connection successful!');
        console.log('Database:', rows[0].database_name);
        console.log('MySQL version:', rows[0].mysql_version);
        console.log('Authenticated user:', rows[0].authenticated_user);
    } catch (error) {
        console.error('Database connection failed:', error.message);
    } finally {
        await pool.end();
    }
}

testConnection();
