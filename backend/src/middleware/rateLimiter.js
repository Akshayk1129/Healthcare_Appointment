const rateLimit = require("express-rate-limit");

/**
 * Rate limiter for LLM-heavy endpoints (e.g. AI symptom analysis, post-visit summary)
 * Limits to 10 requests per 15 minutes per IP.
 */
const llmRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    error: "Too many requests to the AI service from this IP, please try again after 15 minutes",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

module.exports = { llmRateLimiter };
