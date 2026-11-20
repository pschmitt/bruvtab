from argparse import ArgumentTypeError
from io import StringIO
from unittest import TestCase
from unittest.mock import patch

import pytest

from bruvtab.api import QueryError
from bruvtab.api import SingleMediatorAPI
from bruvtab.main import url_pattern
from bruvtab.tests.test_main import WithMediator
from bruvtab.utils import encode_query


class TestUrlPattern(TestCase):
    def test_valid_patterns_are_unchanged(self):
        for pattern in ('https://ticket.example.com/*', '*://*.example.com/*', '<all_urls>',
                        'file:///home/user/*', 'http://localhost:8080/app/*',
                        'chrome://extensions/*', 'chrome-extension://*/*', 'moz-extension://*/*',
                        'http://*:8080/*', 'http://example.com:*/*', 'http://[::1]:8080/*',
                        'about:blank', 'data:*', 'urn:*'):
            assert url_pattern(pattern) == pattern

    def test_missing_scheme_matches_any_scheme(self):
        assert url_pattern('upload.wikimedia.org/*') == '*://upload.wikimedia.org/*'
        assert url_pattern('localhost:8080/app/*') == '*://localhost:8080/app/*'

    def test_missing_path_matches_any_path(self):
        assert url_pattern('https://www.wikipedia.org') == 'https://www.wikipedia.org/*'
        assert url_pattern('chrome://extensions') == 'chrome://extensions/*'

    def test_bare_host(self):
        assert url_pattern('wikipedia.org') == '*://wikipedia.org/*'
        assert url_pattern('*.wikipedia.org') == '*://*.wikipedia.org/*'
        assert url_pattern('localhost:8080') == '*://localhost:8080/*'
        assert url_pattern('example.com:*') == '*://example.com:*/*'

    def test_scheme_is_lower_cased(self):
        assert url_pattern('HTTPS://example.com') == 'https://example.com/*'

    def test_misplaced_host_wildcard_is_explained(self):
        with pytest.raises(ArgumentTypeError, match=r"'\*\.example\.org'"):
            url_pattern('https://www.*.org/')

    def test_missing_host_is_explained(self):
        with pytest.raises(ArgumentTypeError, match='no host'):
            url_pattern('https:///path')


class TestSingleMediatorQueryErrors(TestCase):
    def _api(self, response):
        api = SingleMediatorAPI.__new__(SingleMediatorAPI)
        api._prefix = 'a.'
        api._get = lambda path, data=None: response
        return api

    def test_mediator_error_raises(self):
        with pytest.raises(QueryError, match='did not answer.*/tmp/bruvtab_mediator.log'):
            self._api('<ERROR>').query_tabs({'url': ['*://x/*']})

    def test_browser_error_raises_with_its_message(self):
        with pytest.raises(QueryError, match="Invalid url pattern 'x'"):
            self._api("ERROR\tInvalid url pattern 'x'").query_tabs({'url': ['x']})


class TestUrlPatternCli(WithMediator):
    def test_query_expands_the_pattern(self):
        self.mediator.transport.received_extend(['mocked', []])

        self._run_commands(['query', '-url', 'https://www.wikipedia.org'])

        self._assert_init()
        assert self.mediator.transport.sent == [
            {'name': 'query_tabs', 'query_info': encode_query('{"url": ["https://www.wikipedia.org/*"]}')},
        ]

    def test_invalid_pattern_is_refused_before_asking_the_browser(self):
        with patch('sys.stderr', new_callable=StringIO) as stderr, pytest.raises(SystemExit):
            self._run_commands(['close', '-url', 'https://www.*.org/'])

        assert "'*.example.org'" in stderr.getvalue()
        assert self.mediator.transport.sent == []

    def test_close_reports_a_browser_error_and_closes_nothing(self):
        self.mediator.transport.received_extend(['mocked', ["ERROR\tInvalid url pattern 'x'"]])

        with patch('bruvtab.main.print_error') as print_error:
            result = self._run_commands(['close', '-url', 'https://example.com/*'])

        assert result == 1
        assert "Invalid url pattern 'x'" in print_error.call_args[0][0]
        assert 'close_tabs' not in [c['name'] for c in self.mediator.transport.sent]

    def test_close_without_match_names_the_pattern(self):
        self.mediator.transport.received_extend(['mocked', []])

        with patch('bruvtab.main.print_error') as print_error:
            result = self._run_commands(['close', '-url', 'wikipedia.org'])

        assert result == 1
        print_error.assert_called_once_with('No matching tabs found for -url *://wikipedia.org/*')

    def test_close_without_match_names_a_string_url_from_info(self):
        self.mediator.transport.received_extend(['mocked', []])

        with patch('bruvtab.main.print_error') as print_error:
            result = self._run_commands(['close', '-info', '{"url": "*://x.example.com/*"}'])

        assert result == 1
        print_error.assert_called_once_with('No matching tabs found for -url *://x.example.com/*')
