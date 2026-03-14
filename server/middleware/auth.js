/**
 * Authentication Middleware
 * 
 * Handles Supabase authentication and user verification.
 * Extracts user from JWT token and attaches to request.
 */

const { supabaseAnon, isConfigured } = require('../db/supabase');
const userModel = require('../db/models/users');

/**
 * Extract token from Authorization header
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
  if (!token || token === 'null' || token === 'undefined') {
    return null;
  }
  return token;
}

/**
 * Verify Supabase JWT token and get user
 */
async function verifyToken(token) {
  if (!isConfigured()) {
    return null;
  }

  try {
    const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
    
    if (error || !user) {
      return null;
    }

    return user;
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

/**
 * Authentication middleware
 * Verifies JWT token (Supabase) or session token (Tookan) and attaches user to request
 */
async function authenticate(req, res, next) {
  // Skip auth for health check and public endpoints
  const publicPaths = ['/api/health', '/api/tookan/webhook'];
  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  const token = extractToken(req);
  
  if (!token) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required. Please provide a valid token.',
      data: {}
    });
  }

  // Development fallback: if Supabase is not configured, accept any token and treat as admin
  if (!isConfigured()) {
    req.user = { id: 'local-dev', email: 'local@dev', role: 'admin', permissions: {}, source: 'local' };
    req.userId = 'local-dev';
    return next();
  }

  // Try Supabase JWT token first (only when configured)
  let user = await verifyToken(token);
  
  // If not Supabase token, try direct JWT payload decoding
  if (!user) {
    try {
      const jwtParts = token.split('.');
      if (jwtParts.length === 3) {
        const payload = jwtParts[1];
        const padded = payload.padEnd(payload.length + (4 - payload.length % 4) % 4, '=');
        const tokenData = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
        user = {
          id: tokenData.sub || tokenData.user_id || tokenData.id,
          email: tokenData.email,
          role: tokenData.role || tokenData.app_metadata?.role || 'user',
          permissions: tokenData.permissions || {}
        };
      }
    } catch (decodeError) {
      // Not a valid JWT
    }
  }

  // If not JWT, try Tookan session token (format: userId:timestamp:email)
  if (!user) {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      
      if (parts.length >= 3) {
        const userId = parts[0];
        const email = parts.slice(2).join(':');
        user = {
          id: userId,
          email: email,
          source: 'tookan'
        };
      }
    } catch (decodeError) {
      // Not a valid Tookan token either
    }
  }

  // If nothing else worked, try custom session token format: 'eyJ' + base64(JSON)
  if (!user) {
    try {
      let tokenBody = token;
      if (token.startsWith('eyJ')) {
        tokenBody = token.substring(3);
      }
      const decoded = Buffer.from(tokenBody, 'base64').toString('utf-8');
      const tokenData = JSON.parse(decoded);
      if (tokenData && (tokenData.sub || tokenData.id || tokenData.email)) {
        user = {
          id: tokenData.sub || tokenData.id || tokenData.user_id,
          email: tokenData.email,
          role: tokenData.role || 'user',
          permissions: tokenData.permissions || {},
          source: tokenData.user_type === 'driver' || tokenData.user_type === 'vendor' ? 'tookan' : undefined
        };
      }
    } catch (decodeError) {
      // Not a valid custom session token
    }
  }
  
  if (!user) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.',
      data: {}
    });
  }

  // Get full user profile from database (for Supabase users)
  if (user.source !== 'tookan' && isConfigured()) {
    try {
      const userProfile = await userModel.getUserById(user.id);
      if (userProfile) {
        req.user = {
          ...user,
          role: userProfile.role,
          permissions: userProfile.permissions || {}
        };
      } else {
        req.user = user;
      }
    } catch (error) {
      console.warn('Could not fetch user profile:', error.message);
      req.user = user;
    }
  } else {
    // For Tookan users, use the user object as-is
    // Role and permissions can be set based on userType if stored in token
    req.user = {
      ...user,
      role: user.role || 'user',
      permissions: user.permissions || {}
    };
  }
  
  req.userId = user.id;
  
  next();
}

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't require it
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  
  if (token) {
    // Try Supabase JWT token first
    let user = await verifyToken(token);
    
    // If not Supabase token, try direct JWT payload decoding
    if (!user) {
      try {
        const jwtParts = token.split('.');
        if (jwtParts.length === 3) {
          const payload = jwtParts[1];
          const padded = payload.padEnd(payload.length + (4 - payload.length % 4) % 4, '=');
          const tokenData = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
          user = {
            id: tokenData.sub || tokenData.user_id || tokenData.id,
            email: tokenData.email,
            role: tokenData.role || tokenData.app_metadata?.role || 'user',
            permissions: tokenData.permissions || {}
          };
        }
      } catch (decodeError) {
        // Not a valid JWT
      }
    }

    // If not JWT, try Tookan session token
    if (!user) {
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const parts = decoded.split(':');
        if (parts.length >= 3) {
          const userId = parts[0];
          const email = parts.slice(2).join(':');
          user = { id: userId, email, source: 'tookan' };
        }
      } catch (decodeError) {
        // Not a valid token
      }
    }

    // Try custom session token format
    if (!user) {
      try {
        let tokenBody = token;
        if (token.startsWith('eyJ')) tokenBody = token.substring(3);
        const decoded = Buffer.from(tokenBody, 'base64').toString('utf-8');
        const tokenData = JSON.parse(decoded);
        if (tokenData && (tokenData.sub || tokenData.id || tokenData.email)) {
          user = {
            id: tokenData.sub || tokenData.id || tokenData.user_id,
            email: tokenData.email,
            role: tokenData.role || 'user',
            permissions: tokenData.permissions || {},
            source: tokenData.user_type === 'driver' || tokenData.user_type === 'vendor' ? 'tookan' : undefined
          };
        }
      } catch (decodeError) {
        // Not a valid custom session token
      }
    }
    
    if (user) {
      req.user = user;
      req.userId = user.id;
    }
  }
  
  next();
}

/**
 * Permission check middleware factory
 * Creates middleware to check if user has required permission
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user || !req.userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: {}
      });
    }

    try {
      // Admin role has all permissions
      if (req.user.role === 'admin') {
        return next();
      }

      // For Tookan users (source: 'tookan'), check if they have permission in user object
      if (req.user && req.user.source === 'tookan') {
        // Tookan users have basic permissions by default
        // You can extend this to check req.user.permissions if stored in token
        const tookanPermissions = req.user.permissions || {};
        if (tookanPermissions[permission] === true || req.user.role === 'admin') {
          return next();
        }
        // For now, allow Tookan users to access most endpoints
        // You can restrict specific permissions here if needed
        return next();
      }

      // For Supabase users, check database
      if (isConfigured() && req.user && req.user.source !== 'tookan') {
        try {
          const hasPerm = await userModel.hasPermission(req.userId, permission);
          
          if (!hasPerm) {
            return res.status(403).json({
              status: 'error',
              message: `Permission denied. Required permission: ${permission}`,
              data: {}
            });
          }
        } catch (dbError) {
          // If database lookup fails (e.g., Tookan user ID format), allow access
          console.warn('Permission check database error (allowing access):', dbError.message);
          return next();
        }
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      // For Tookan users, allow access on error (graceful degradation)
      if (req.user.source === 'tookan') {
        return next();
      }
      return res.status(500).json({
        status: 'error',
        message: 'Error checking permissions',
        data: {}
      });
    }
  };
}

/**
 * Role check middleware factory
 * Creates middleware to check if user has required role
 */
function requireRole(role) {
  return async (req, res, next) => {
    if (!req.user || !req.userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: {}
      });
    }

    try {
      // For Tookan users, check role from user object
      if (req.user && req.user.source === 'tookan') {
        // Tookan users can be assigned roles in the token or default to 'user'
        // For now, allow if role matches or if user is admin
        if (req.user.role === role || req.user.role === 'admin') {
          return next();
        }
        // For endpoints requiring admin, Tookan users need explicit admin role
        // You can set this in the login endpoint when creating the token
        return res.status(403).json({
          status: 'error',
          message: `Permission denied. Required role: ${role}`,
          data: {}
        });
      }

      // For Supabase users, check database
      if (isConfigured() && req.user && req.user.source !== 'tookan') {
        try {
          const hasRole = await userModel.hasRole(req.userId, role);
          
          if (!hasRole) {
            return res.status(403).json({
              status: 'error',
              message: `Permission denied. Required role: ${role}`,
              data: {}
            });
          }
        } catch (dbError) {
          // If database lookup fails (e.g., Tookan user ID format), deny access for role checks (safer)
          console.warn('Role check database error:', dbError.message);
          return res.status(403).json({
            status: 'error',
            message: `Permission denied. Required role: ${role}`,
            data: {}
          });
        }
      }

      next();
    } catch (error) {
      console.error('Role check error:', error);
      // For Tookan users, deny access on error (safer for role checks)
      return res.status(500).json({
        status: 'error',
        message: 'Error checking role',
        data: {}
      });
    }
  };
}

/**
 * Get user from database (helper function)
 */
async function getUserFromDB(userId) {
  try {
    return await userModel.getUserById(userId);
  } catch (error) {
    console.error('Error fetching user from DB:', error);
    return null;
  }
}

/**
 * Superadmin email - the only user who can manage other users
 */
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'ahmedhassan123.ah83@gmail.com';

/**
 * Check if the current user is the superadmin
 */
function isSuperadmin(user) {
  if (!user) return false;
  return user.email === SUPERADMIN_EMAIL;
}

/**
 * Middleware to require superadmin access
 * Only the superadmin can create/manage users
 */
function requireSuperadmin() {
  return async (req, res, next) => {
    if (!req.user || !req.userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        data: {}
      });
    }

    if (!isSuperadmin(req.user)) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Only the superadmin can perform this action.',
        data: {}
      });
    }

    next();
  };
}

/**
 * Check if user is enabled (not disabled or banned)
 */
async function checkUserStatus(req, res, next) {
  if (!req.user || !req.userId) {
    return next(); // Let authenticate middleware handle this
  }

  // Superadmin is always allowed
  if (isSuperadmin(req.user)) {
    return next();
  }

  // For Tookan users, check stored status
  if (req.user.source === 'tookan' && isConfigured()) {
    try {
      const userProfile = await userModel.getUserByEmail(req.user.email);
      if (userProfile) {
        if (userProfile.status === 'banned') {
          return res.status(403).json({
            status: 'error',
            message: 'Your account has been banned. Please contact the administrator.',
            data: {}
          });
        }
        if (userProfile.status === 'disabled' || userProfile.status === 'inactive') {
          return res.status(403).json({
            status: 'error',
            message: 'Your account has been disabled. Please contact the administrator.',
            data: {}
          });
        }
      }
    } catch (error) {
      // If status check fails, allow access (graceful degradation)
      console.warn('User status check failed:', error.message);
    }
  }

  next();
}

module.exports = {
  authenticate,
  optionalAuth,
  requirePermission,
  requireRole,
  requireSuperadmin,
  checkUserStatus,
  isSuperadmin,
  verifyToken,
  getUserFromDB,
  SUPERADMIN_EMAIL
};





