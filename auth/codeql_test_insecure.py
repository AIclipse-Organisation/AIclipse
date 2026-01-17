# codeql_test_insecure.py
import pickle
from flask import request

def insecure_deserialize():
    # INTENTIONALLY INSECURE (for CodeQL test): unsafe deserialization
    data = request.get_data()
    return pickle.loads(data)
