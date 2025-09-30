#!/usr/bin/env node
require('dotenv').config();
const admin = require('firebase-admin');
const https = require('https');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const TEST_STORY_ID = 'test_story_e2e_1';

async function getIdToken() {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  const webApiKey = process.env.FIREBASE_WEB_API_KEY;

  if (!email || !password) {
    throw new Error('TEST_USER_EMAIL and TEST_USER_PASSWORD must be set');
  }

  if (!webApiKey) {
    console.log('⚠️  FIREBASE_WEB_API_KEY not set, using Admin SDK custom token approach');
    const user = await admin.auth().getUserByEmail(email);
    const customToken = await admin.auth().createCustomToken(user.uid);
    return { customToken, userId: user.uid };
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      email,
      password,
      returnSecureToken: true
    });

    const options = {
      hostname: 'identitytoolkit.googleapis.com',
      path: `/v1/accounts:signInWithPassword?key=${webApiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (res.statusCode === 200) {
            resolve({ idToken: response.idToken, userId: response.localId });
          } else {
            reject(new Error(response.error?.message || 'Authentication failed'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function makeRequest(method, path, token, body = null) {
  const url = new URL(path, BASE_URL);
  
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const requestBody = body ? JSON.stringify(body) : null;
    if (requestBody) {
      options.headers['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const protocol = url.protocol === 'https:' ? https : require('http');
    options.hostname = url.hostname;
    options.port = url.port || (url.protocol === 'https:' ? 443 : 80);
    options.path = url.pathname + url.search;

    const req = protocol.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const data = responseBody ? JSON.parse(responseBody) : null;
          resolve({
            status: res.statusCode,
            data,
            headers: res.headers
          });
        } catch (error) {
          resolve({
            status: res.statusCode,
            data: responseBody,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);
    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

async function runSmokeTests() {
  console.log('🧪 Starting API Smoke Tests\n');
  console.log(`Base URL: ${BASE_URL}\n`);

  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  try {
    // Get authentication token
    console.log('🔐 Authenticating test user...');
    const authResult = await getIdToken();
    const token = authResult.idToken || authResult.customToken;
    const userId = authResult.userId;
    console.log(`✅ Authenticated as user: ${userId}\n`);

    // Test 1: GET /api/stories/:id/audio-status (public endpoint)
    console.log('Test 1: GET /api/stories/test_story_e2e_1/audio-status');
    try {
      const response = await makeRequest('GET', `/api/stories/${TEST_STORY_ID}/audio-status`, null);
      if (response.status === 200 && response.data) {
        console.log(`✅ PASS - Status: ${response.status}`);
        console.log(`   Audio Status: ${response.data.audioStatus}`);
        console.log(`   Transcript Status: ${response.data.transcriptStatus}`);
        results.passed++;
        results.tests.push({ name: 'GET audio-status', status: 'PASS' });
      } else {
        console.log(`❌ FAIL - Status: ${response.status}`);
        console.log(`   Response: ${JSON.stringify(response.data)}`);
        results.failed++;
        results.tests.push({ 
          name: 'GET audio-status', 
          status: 'FAIL',
          details: { status: response.status, response: response.data }
        });
      }
    } catch (error) {
      console.log(`❌ FAIL - Error: ${error.message}`);
      results.failed++;
      results.tests.push({ 
        name: 'GET audio-status', 
        status: 'FAIL',
        details: error.message
      });
    }
    console.log('');

    // Test 2: GET /v1/stories (with auth)
    console.log('Test 2: GET /v1/stories (list stories)');
    try {
      const response = await makeRequest('GET', '/v1/stories?limit=5', token);
      if (response.status === 200 && response.data) {
        console.log(`✅ PASS - Status: ${response.status}`);
        console.log(`   Stories returned: ${response.data.stories?.length || 0}`);
        results.passed++;
        results.tests.push({ name: 'GET stories list', status: 'PASS' });
      } else {
        console.log(`❌ FAIL - Status: ${response.status}`);
        console.log(`   Response: ${JSON.stringify(response.data)}`);
        results.failed++;
        results.tests.push({ 
          name: 'GET stories list', 
          status: 'FAIL',
          details: { status: response.status, response: response.data }
        });
      }
    } catch (error) {
      console.log(`❌ FAIL - Error: ${error.message}`);
      results.failed++;
      results.tests.push({ 
        name: 'GET stories list', 
        status: 'FAIL',
        details: error.message
      });
    }
    console.log('');

    // Test 3: GET specific test story
    console.log('Test 3: GET /v1/stories/test_story_e2e_1');
    try {
      const response = await makeRequest('GET', `/v1/stories/${TEST_STORY_ID}`, token);
      if (response.status === 200 && response.data) {
        console.log(`✅ PASS - Status: ${response.status}`);
        console.log(`   Story Title: ${response.data.title}`);
        results.passed++;
        results.tests.push({ name: 'GET specific story', status: 'PASS' });
      } else {
        console.log(`❌ FAIL - Status: ${response.status}`);
        console.log(`   Response: ${JSON.stringify(response.data)}`);
        results.failed++;
        results.tests.push({ 
          name: 'GET specific story', 
          status: 'FAIL',
          details: { status: response.status, response: response.data }
        });
      }
    } catch (error) {
      console.log(`❌ FAIL - Error: ${error.message}`);
      results.failed++;
      results.tests.push({ 
        name: 'GET specific story', 
        status: 'FAIL',
        details: error.message
      });
    }
    console.log('');

    // Summary
    console.log('━'.repeat(50));
    console.log('📊 SMOKE TEST SUMMARY');
    console.log('━'.repeat(50));
    console.log(`Total Tests: ${results.passed + results.failed}`);
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log('');

    if (results.failed > 0) {
      console.log('Failed Tests:');
      results.tests.filter(t => t.status === 'FAIL').forEach(test => {
        console.log(`  - ${test.name}`);
        if (test.details) {
          console.log(`    Details: ${JSON.stringify(test.details, null, 2)}`);
        }
      });
    }

    process.exit(results.failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('❌ Smoke tests failed:', error.message);
    process.exit(1);
  }
}

runSmokeTests();
