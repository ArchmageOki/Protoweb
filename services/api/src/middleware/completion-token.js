// Middleware para validar token de completar datos (sin requerir autenticación)
import { pgGetClientCompletionToken } from "../db/pg.js";

export async function validateCompletionToken(req, res, next) {
  const token = req.query.token || req.body.token;

  if (!token) {
    return res.status(401).json({ error: "token_required" });
  }

  try {
    const tokenData = await pgGetClientCompletionToken(token);

    if (!tokenData) {
      return res.status(401).json({ error: "invalid_token" });
    }

    if (tokenData.used) {
      return res.status(401).json({ error: "token_used" });
    }

    // Verificar expiración (7 días)
    const now = new Date();
    if (tokenData.expires_at && now > new Date(tokenData.expires_at)) {
      return res.status(401).json({ error: "token_expired" });
    }

    // Adjuntar datos del token a la request
    req.completionToken = tokenData;
    req.client_id = tokenData.client_id;
    req.user_id = tokenData.user_id;

    next();
  } catch (error) {
    console.error("[completion-token] Error validating token:", error);
    res.status(500).json({ error: "internal_error" });
  }
}
