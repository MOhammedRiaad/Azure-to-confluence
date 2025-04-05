const validateConfig = (config) => {
  const requiredConfigs = {
    confluence: ['baseUrl', 'password', 'spaceKey', 'parentPageId'],
    paths: ['wikiRoot']
  };

  const errors = [];

  for (const [section, fields] of Object.entries(requiredConfigs)) {
    for (const field of fields) {
      if (!config[section]?.[field]) {
        errors.push(`Missing required config: ${section}.${field}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
};

module.exports = { validateConfig };