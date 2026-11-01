/** The Django API, e.g. http://localhost:8000/api. Only the Next.js server talks to it. */
const url = process.env.API_URL
if (!url && process.env.NODE_ENV === "production") {
  // Falling back to localhost on a live site would break every page with a vague error,
  // so fail loudly at startup instead.
  throw new Error("API_URL must be set to the Django API address, e.g. https://api.example.com/api")
}
export const API_URL = (url ?? "http://localhost:8000/api").replace(/\/$/, "")
