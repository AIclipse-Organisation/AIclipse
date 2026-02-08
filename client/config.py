import os
import requests
import logging

class Config:
    def __init__(self):
        # Determine environment: default to 'dev'
        self.env = os.getenv("APP_ENV", "dev")
        self.config_url = os.getenv("CENTRAL_CONFIG_URL")
        print(f"DEBUG: Config url {self.config_url}")
        self.debug = True if self.env == "dev" else False

        self._raw_config = {}
        if self.config_url:
            self._load_remote_config()

    def _load_remote_config(self):
        try:
            resp = requests.get(self.config_url, timeout=5)
            resp.raise_for_status()
            # FIX: Assign to self._raw_config, not a local variable
            self._raw_config = resp.json() 
            
            logging.info(f"[*] Loaded {self.env} config from remote")
        except Exception as e:
            logging.error(f"[!] Failed to load remote config: {e}")
   
    def get_client_config(self):
        env_node = self._raw_config.get(self.env, {})
        
        client_node = env_node.get("client", {})
        
        toggles = client_node.get("feature-toggle", {})
        
        print(f"DEBUG: Toggles found in {self.env} cache: {toggles}")
    
        return toggles
            

cfg = Config()