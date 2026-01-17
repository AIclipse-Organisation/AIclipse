// pages/api/codeql-test.js
export default function handler(req, res) {
  // INTENTIONALLY INSECURE (for CodeQL test): eval on user-controlled input
  const userCode = req.query.code;
  // eslint-disable-next-line no-eval
  const result = eval(userCode);
  res.status(200).json({ result });
}
