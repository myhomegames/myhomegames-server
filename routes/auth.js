// routes/auth.js — optional API_TOKEN validation for development

const API_TOKEN = process.env.API_TOKEN;

function registerAuthRoutes(app) {
  app.get("/auth/me", (req, res) => {
    const token =
      req.header("X-Auth-Token") || req.query.token || req.header("Authorization");

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (API_TOKEN && token === API_TOKEN) {
      return res.json({
        userId: "dev",
        userName: "Development User",
        userImage: null,
        isDev: true,
      });
    }

    return res.status(401).json({ error: "Unauthorized" });
  });

  app.post("/auth/logout", (req, res) => {
    res.json({ status: "success" });
  });
}

function isValidToken(token) {
  return Boolean(API_TOKEN && token === API_TOKEN);
}

module.exports = {
  registerAuthRoutes,
  isValidToken,
};
