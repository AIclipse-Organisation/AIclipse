import pytest
import httpx
from detector_modules.io.fetcher import fetch_image_bytes

def test_fetch_image_bytes_success(monkeypatch):
    dummy_bytes = b'test'

    # Define a mock response object
    class MockResponse:
        def __init__(self, status_code=200, content=b'test'):
            self.status_code = status_code
            self._content = content

        def raise_for_status(self):
            if self.status_code != 200:
                raise httpx.HTTPStatusError("Error", request=None, response=None)

        @property
        def content(self):
            return self._content

    # Define a mock get function
    def mock_get(url, timeout):
        return MockResponse()

    # Patch httpx.get with our mock_get
    monkeypatch.setattr(httpx, "get", mock_get)

    result = fetch_image_bytes("http://example.com/image.png")
    assert result == dummy_bytes

def test_fetch_image_bytes_http_error(monkeypatch):
    # Define a mock response that raises an HTTP error
    class MockResponse:
        def raise_for_status(self):
            raise httpx.HTTPStatusError("Not Found", request=None, response=None)

    def mock_get(url, timeout):
        return MockResponse()

    # Patch httpx.get with our mock_get
    monkeypatch.setattr(httpx, "get", mock_get)

    with pytest.raises(httpx.HTTPStatusError):
        fetch_image_bytes("http://example.com/missing.png")