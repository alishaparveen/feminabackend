const VALID_PILLARS = ['health', 'money', 'heart', 'life', 'soul'];

function validateOnboardingData(name, age, pillars, tags = []) {
  const errors = {};
  
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.name = 'Name is required';
  } else if (name.trim().length > 50) {
    errors.name = 'Name must be 50 characters or less';
  }
  
  if (age === undefined || age === null || typeof age !== 'number') {
    errors.age = 'Age is required';
  } else if (age < 13 || age > 120) {
    errors.age = 'Age must be between 13 and 120';
  }
  
  if (!Array.isArray(pillars) || pillars.length === 0) {
    errors.pillars = 'At least one pillar must be selected';
  } else if (pillars.length > 5) {
    errors.pillars = 'Maximum 5 pillars allowed';
  } else if (pillars.some(p => !VALID_PILLARS.includes(p))) {
    errors.pillars = 'Invalid pillar selection';
  }
  
  if (!Array.isArray(tags)) {
    errors.tags = 'Tags must be an array';
  }
  
  return errors;
}

console.log('\n=== Onboarding Endpoint Validation Tests ===\n');

console.log('Test 1: Valid data');
let errors = validateOnboardingData('Alisha', 29, ['health', 'heart'], ['IVF', 'Mental Health']);
console.log(Object.keys(errors).length === 0 ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 2: Missing name');
errors = validateOnboardingData('', 29, ['health'], []);
console.log(errors.name ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 3: Name too long');
errors = validateOnboardingData('a'.repeat(51), 29, ['health'], []);
console.log(errors.name ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 4: Age too young');
errors = validateOnboardingData('Test', 12, ['health'], []);
console.log(errors.age ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 5: Age too old');
errors = validateOnboardingData('Test', 121, ['health'], []);
console.log(errors.age ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 6: Missing age');
errors = validateOnboardingData('Test', undefined, ['health'], []);
console.log(errors.age ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 7: No pillars');
errors = validateOnboardingData('Test', 29, [], []);
console.log(errors.pillars ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 8: Too many pillars');
errors = validateOnboardingData('Test', 29, ['health', 'money', 'heart', 'life', 'soul', 'extra'], []);
console.log(errors.pillars ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 9: Invalid pillar');
errors = validateOnboardingData('Test', 29, ['invalid'], []);
console.log(errors.pillars ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 10: Valid with all 5 pillars');
errors = validateOnboardingData('Test', 29, ['health', 'money', 'heart', 'life', 'soul'], ['tag1', 'tag2']);
console.log(Object.keys(errors).length === 0 ? '✅ PASS' : '❌ FAIL', errors);

console.log('\nTest 11: Valid with empty tags');
errors = validateOnboardingData('Test', 29, ['health'], []);
console.log(Object.keys(errors).length === 0 ? '✅ PASS' : '❌ FAIL', errors);

console.log('\n=== All Tests Complete ===\n');

process.exit(0);
