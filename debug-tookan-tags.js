require('dotenv').config();
const fetch = require('node-fetch');

const TOOKAN_API_KEY = process.env.TOOKAN_API_KEY;

async function testTags() {
    const response = await fetch('https://api.tookanapp.com/v2/get_job_details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: TOOKAN_API_KEY,
            job_ids: [590611470],
            job_additional_info: 1
        })
    });

    const data = await response.json();
    console.log('Status:', data.status);
    if (data.data) { // get_job_details returns a single job object directly under data, not an array
        const task = data.data;
        console.log('Sample Task Structure (Fields):', Object.keys(task).join(', '));
        console.log('Tags value:', task.tags);
        console.log('Job Tags value:', task.job_tags);
        console.log('Raw Task (first task):', JSON.stringify(task, null, 2));
    } else {
        console.log('No tasks found for today to inspect.');
    }
}

testTags();
