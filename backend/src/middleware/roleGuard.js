/**
 * Role-based authorization middleware factory.
 * Usage: authorize('ADMIN') or authorize('DOCTOR', 'ADMIN')
 *
 * Must be used AFTER the authenticate middleware so req.user exists.
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
      });
    }

    next();
  };
}

module.exports = { authorize };
