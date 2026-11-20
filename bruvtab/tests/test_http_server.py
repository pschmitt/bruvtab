from io import BytesIO
from json import dumps
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import quote_plus

import pytest

from bruvtab.api import SingleMediatorAPI
from bruvtab.mediator.http_server import MediatorHttpServer
from bruvtab.mediator.remote_api import BrowserRemoteAPI


def test_move_tabs_route_forwards_triplets():
    remote_api = Mock()
    remote_api.move_tabs.return_value = 'OK'
    with patch('bruvtab.mediator.http_server.make_server'):
        server = MediatorHttpServer('127.0.0.1', 0, remote_api, 0.1)
    server.app.config['TESTING'] = True
    triplets = '9624740 9624730 44,9624741 9624730 45'

    response = server.app.test_client().get('/move_tabs/' + quote_plus(triplets))

    assert response.status_code == 200
    assert response.data == b'OK'
    remote_api.move_tabs.assert_called_once_with(triplets)


@pytest.fixture
def mediator_http_client():
    remote_api = Mock()
    with patch('bruvtab.mediator.http_server.make_server'):
        server = MediatorHttpServer('127.0.0.1', 0, remote_api, 0.1)
    server.app.config['TESTING'] = True
    return server.app.test_client(), remote_api


def test_tab_group_route_preserves_group_created_before_metadata_error(mediator_http_client):
    client, remote_api = mediator_http_client
    payload = {'action': 'create', 'window_id': 42, 'tab_ids': [5, 7], 'properties': {'title': 'Reading'}}
    result = {'ok': False, 'error': 'The group was created, but its title could not be set', 'groupId': 9}
    remote_api.tab_group_command.return_value = result

    response = client.post('/tab_group_command', data={'command': (BytesIO(dumps(payload).encode()), 'command')})

    assert response.status_code == 200
    assert response.get_json() == result
    remote_api.tab_group_command.assert_called_once_with(payload)


@pytest.mark.parametrize('body', [
    b'not-json',
    b'{"action":[]}',
    b'{"action":"list","window_id":false}',
    b'{"action":"create","window_id":42,"tab_ids":[true]}',
    b'{"action":"create","window_id":42,"tab_ids":[4,4]}',
    b'{"action":"create","window_id":42,"tab_ids":[4],"properties":{"collapsed":1}}',
    b'{"action":"update","window_id":42,"group_id":9,"properties":{}}',
    b'{"action":"ungroup","tab_ids":[4]}',
])
def test_tab_group_route_rejects_invalid_commands(mediator_http_client, body):
    client, remote_api = mediator_http_client

    response = client.post('/tab_group_command', data={'command': (BytesIO(body), 'command')})

    assert response.status_code == 400
    assert response.get_json()['ok'] is False
    remote_api.tab_group_command.assert_not_called()
    assert client.get('/get_pid').status_code == 200


def test_tab_group_native_command_returns_single_response():
    transport = Mock()
    transport.recv.return_value = {'ok': True, 'groups': []}

    assert BrowserRemoteAPI(transport).tab_group_command({'action': 'list'}) == {'ok': True, 'groups': []}
    transport.send.assert_called_once_with({'name': 'tab_group_command', 'action': 'list'})
    transport.recv.assert_called_once_with()


@pytest.fixture
def mediator_api():
    client = Mock()
    client.get.side_effect = ['123', 'chrome']
    return SingleMediatorAPI('a', client=client), client


def test_tab_group_api_posts_structured_request(mediator_api):
    api, client = mediator_api
    client.post.return_value = '{"ok":true,"groups":[]}'

    assert api.tab_group_command({'action': 'list'}) == {'ok': True, 'groups': []}
    client.post.assert_called_once_with('/tab_group_command', {'command': dumps({'action': 'list'})})


def test_tab_group_api_reports_old_mediator(mediator_api):
    api, client = mediator_api
    client.post.side_effect = HTTPError('', 404, 'Not Found', {}, None)

    result = api.tab_group_command({'action': 'list'})

    assert result == {'ok': False, 'error': 'Tab groups require an updated BruvTab mediator'}
    assert client.post.call_count == 1


def test_tab_group_api_reports_old_extension(mediator_api):
    api, client = mediator_api
    client.post.return_value = '{"error":"Unknown command: tab_group_command"}'

    result = api.tab_group_command({'action': 'list'})

    assert result == {'ok': False, 'error': 'Tab groups require an updated BruvTab browser extension'}
    assert client.post.call_count == 1


def test_tab_group_api_never_retries_ambiguous_mutation(mediator_api):
    api, client = mediator_api
    client.post.side_effect = TimeoutError

    result = api.tab_group_command({'action': 'create', 'window_id': 42, 'tab_ids': [5, 7]})

    assert result['ok'] is False
    assert 'Inspect the browser before retrying' in result['error']
    assert client.post.call_count == 1
