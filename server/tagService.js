/**
 * Tag Service
 * 
 * Manages tag assignment rules for delivery charges and other task categorization.
 * Tags are used in Tookan to control delivery charge pricing via tag-based pricing rules.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TAG_CONFIG_FILE = path.join(DATA_DIR, 'tagConfig.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load tag configuration from file
 */
function loadTagConfig() {
  try {
    if (fs.existsSync(TAG_CONFIG_FILE)) {
      const data = fs.readFileSync(TAG_CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading tag config:', error);
  }
  
  // Return default structure
  return {
    rules: [],
    tags: [],
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Save tag configuration to file
 */
function saveTagConfig(config) {
  try {
    config.lastUpdated = new Date().toISOString();
    fs.writeFileSync(TAG_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving tag config:', error);
    return false;
  }
}

/**
 * Get tags for a customer based on rules
 * 
 * @param {Object} customerData - Customer data (plan, zone, subscription, etc.)
 * @returns {Array<string>} Array of tag names
 */
function getTagsForCustomer(customerData = {}) {
  const config = loadTagConfig();
  const tags = new Set();
  
  // Add default tags if any
  if (config.defaultTags && Array.isArray(config.defaultTags)) {
    config.defaultTags.forEach(tag => tags.add(tag));
  }
  
  // Evaluate rules
  if (config.rules && Array.isArray(config.rules)) {
    config.rules.forEach(rule => {
      if (evaluateRule(rule, customerData)) {
        if (rule.tags && Array.isArray(rule.tags)) {
          rule.tags.forEach(tag => tags.add(tag));
        }
      }
    });
  }
  
  return Array.from(tags);
}

/**
 * Get tags for a task based on task data
 * 
 * @param {Object} taskData - Task data (customer info, addresses, etc.)
 * @returns {Array<string>} Array of tag names
 */
function getTagsForTask(taskData = {}) {
  // Extract customer data from task
  const customerData = {
    plan: taskData.customerPlan || taskData.plan,
    zone: taskData.deliveryZone || taskData.zone,
    subscription: taskData.subscription,
    customerId: taskData.customer_id || taskData.customerId,
    vendorId: taskData.vendor_id || taskData.vendorId,
    city: extractCityFromAddress(taskData.delivery_address || taskData.deliveryAddress),
    // Add any other relevant fields
    ...taskData
  };
  
  return getTagsForCustomer(customerData);
}

/**
 * Evaluate a rule against customer data
 * 
 * @param {Object} rule - Rule object with condition and tags
 * @param {Object} customerData - Customer data to evaluate against
 * @returns {boolean} True if rule matches
 */
function evaluateRule(rule, customerData) {
  if (!rule.condition) {
    return false;
  }
  
  // Simple condition evaluation
  // Supports: plan === 'premium', zone === 'A', etc.
  try {
    // Replace variables in condition with actual values
    let condition = rule.condition;
    
    // Replace common patterns
    Object.keys(customerData).forEach(key => {
      const value = customerData[key];
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      if (typeof value === 'string') {
        condition = condition.replace(regex, `'${value}'`);
      } else {
        condition = condition.replace(regex, value);
      }
    });
    
    // Evaluate condition (simple evaluation, not full JS parser)
    // For production, consider using a proper expression evaluator
    return eval(condition); // eslint-disable-line no-eval
  } catch (error) {
    console.error('Error evaluating rule condition:', error);
    return false;
  }
}

/**
 * Extract city from address string
 * 
 * @param {string} address - Full address string
 * @returns {string} City name or empty string
 */
function extractCityFromAddress(address) {
  if (!address) return '';
  
  // Simple extraction - can be enhanced
  const parts = address.split(',');
  if (parts.length > 1) {
    return parts[parts.length - 2]?.trim() || '';
  }
  return '';
}

/**
 * Validate tag format
 * 
 * @param {string} tag - Tag name to validate
 * @returns {boolean} True if valid
 */
function validateTag(tag) {
  if (!tag || typeof tag !== 'string') {
    return false;
  }
  
  // Tags should be alphanumeric with underscores, no spaces
  const tagRegex = /^[A-Z0-9_]+$/i;
  return tagRegex.test(tag) && tag.length > 0 && tag.length <= 50;
}

/**
 * Get all available tags from configuration
 * 
 * @returns {Array<string>} Array of all configured tags
 */
function getAllTags() {
  const config = loadTagConfig();
  const tags = new Set();
  
  // Collect tags from rules
  if (config.rules && Array.isArray(config.rules)) {
    config.rules.forEach(rule => {
      if (rule.tags && Array.isArray(rule.tags)) {
        rule.tags.forEach(tag => tags.add(tag));
      }
    });
  }
  
  // Add explicitly defined tags
  if (config.tags && Array.isArray(config.tags)) {
    config.tags.forEach(tag => tags.add(tag));
  }
  
  return Array.from(tags).sort();
}

/**
 * Update tag configuration
 * 
 * @param {Object} newConfig - New configuration object
 * @returns {boolean} True if saved successfully
 */
function updateTagConfig(newConfig) {
  const currentConfig = loadTagConfig();
  const mergedConfig = {
    ...currentConfig,
    ...newConfig,
    lastUpdated: new Date().toISOString()
  };
  
  return saveTagConfig(mergedConfig);
}

/**
 * Suggest tags for given customer/task data
 * 
 * @param {Object} data - Customer or task data
 * @returns {Array<string>} Suggested tags
 */
function suggestTags(data) {
  return getTagsForCustomer(data);
}

module.exports = {
  getTagsForCustomer,
  getTagsForTask,
  validateTag,
  getAllTags,
  updateTagConfig,
  loadTagConfig,
  saveTagConfig,
  suggestTags
};











