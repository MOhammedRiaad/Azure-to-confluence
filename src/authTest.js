const  Confluence = require('./utils/Confluence-API.js');

async function testAuthentication(config) {
  try {
    const confluenceClient = new Confluence();

    // Make a simple API request to test authentication
    await confluenceClient.getSpaceByKey(
      config.confluence.spaceKey,
    
      (error, response) => {
        if (error) {
          throw new Error(`Authentication failed: ${error.message}`);
        }else{
          console.log('Authentication successful!',response);
          return true;
        }
      }
    );

    
  } catch (error) {
    console.error('Authentication failed:', error.message);
    return false;
  }
}

module.exports = { testAuthentication };