const jwt = require('jsonwebtoken');

// Verifies the JWT from the httpOnly cookie and attaches req.user.
// Stateless — no session store, no Redis (rule 29/30).
function authenticate(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role, username, studentId?, teacherId? }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Restricts a route to one or more roles. Real authorization lives here,
// server-side — never enforced by hiding a frontend button (rule 13).
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
