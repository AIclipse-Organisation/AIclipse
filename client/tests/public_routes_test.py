from __future__ import annotations

from unittest.mock import Mock


def test_login_renders_login_instead_of_redirecting_authenticated_user(main_client_module):
    main_client_module.gateway.fetch_me = Mock(side_effect=AssertionError("fetch_me must not be called"))

    client = main_client_module.app.test_client()
    client.set_cookie("access_token", "valid-token")

    resp = client.get("/login")

    assert resp.status_code == 200
    assert "Location" not in resp.headers
    main_client_module.gateway.fetch_me.assert_not_called()
