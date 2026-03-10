from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

module_path = Path(__file__).with_name("main-client.py")
spec = spec_from_file_location("main_client_app", module_path)
module = module_from_spec(spec)

if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load Flask app from main-client.py")

spec.loader.exec_module(module)
app = module.app