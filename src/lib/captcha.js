export function generateCaptcha() {
  const num1 = Math.floor(Math.random() * 9) + 1; // 1 to 9
  const num2 = Math.floor(Math.random() * 9) + 1; // 1 to 9
  const question = `What is ${num1} + ${num2}?`;
  const answer = String(num1 + num2);
  return { question, answer };
}

export function verifyCaptcha(submitted, cookieValue) {
  if (!submitted || !cookieValue) return false;
  
  const parts = String(cookieValue).split('|');
  if (parts.length !== 2) return false;
  
  const [ans, timestampStr] = parts;
  if (submitted.trim() !== ans) return false;
  
  const timestamp = Number(timestampStr);
  if (isNaN(timestamp) || Date.now() - timestamp > 10 * 60 * 1000) {
    return false; // Expired after 10 minutes
  }
  
  return true;
}
