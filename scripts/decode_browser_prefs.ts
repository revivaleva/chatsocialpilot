const base64 = "CtIBCh5icm93c2VyX2FsbG93bGlzdF9zZW50aW5lbF9rZXkSrwEKrAFDZ2xzYjJOaGJHaHZjM1FLTFhKbGMyVnlkbUYwYVc5dUxuSnZiR1Y0WW05MWRHbHhkV1V0YjIxdmRHVnpZVzVrYnkxMGIydDVieTVxY0FvUFpHOWpjeTV6YlhOd2RtRXVZMjl0Q2c1M2QzY3VaMjl2WjJ4bExtTnZiUW9pY21WelpYSjJZWFJwYjI0dWNtOXNaWGhpYjNWMGFYRjFaUzFzWlhocFlTNXFjQT09CjIKKGJyb3dzZXJfanNfZXhlY3V0aW9uX2NvbmZpZ19zZW50aW5lbF9rZXkSBgoEQ0FRPQ==";
const buffer = Buffer.from(base64, 'base64');
console.log(buffer.toString('utf-8'));
console.log('---');
const configB64 = "EAM="; // Wait, from the string it was "EAM="? No, in the log it said "EAM=" for terminal.
// Let's look at the raw bytes for browser_js_execution_config_sentinel_key.
// The value after "config_sentinel_key" was "EAM=" in the AgentPrefs, but let's see here.
// In the VALUE string: "...config_sentinel_key  CAE=" (Wait, I need to read the previous output carefully).
