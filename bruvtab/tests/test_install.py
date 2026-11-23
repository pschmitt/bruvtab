import json
from pathlib import Path

import pytest

from bruvtab.main import run_commands


@pytest.mark.parametrize(
    ('args', 'browser_dirs'),
    [
        ([], ['Google/Chrome']),
        (['--browser', 'brave'], ['Google/Chrome']),
        (['--browser', 'chromium'], ['Chromium']),
        (['--browser', 'firefox'], ['Mozilla']),
        (['--browser', 'all', '--tests'], ['Google/Chrome', 'Chromium', 'Mozilla']),
    ],
)
def test_install_uses_macos_native_messaging_paths(
    args, browser_dirs, tmp_path, monkeypatch, capsys
):
    monkeypatch.setattr('bruvtab.platform.platform.system', lambda: 'Darwin')
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('USERPROFILE', str(tmp_path))
    mediator = (tmp_path / 'Some Tools' / 'bruvtab_mediator').as_posix()
    monkeypatch.setattr('bruvtab.main.which', lambda _name: mediator)

    run_commands(['install', *args])

    expected_parents = {
        Path('Library/Application Support', browser_dir, 'NativeMessagingHosts')
        for browser_dir in browser_dirs
    }
    manifests = list(tmp_path.rglob('bruvtab_mediator.json'))
    assert {path.parent.relative_to(tmp_path) for path in manifests} == expected_parents
    assert capsys.readouterr().out.count('Installing mediator manifest') == len(browser_dirs)
    for path in manifests:
        manifest = json.loads(path.read_text(encoding='utf8'))
        assert manifest['name'] == 'bruvtab_mediator'
        assert manifest['path'] == mediator
        if path.parent.parent.name == 'Mozilla':
            assert 'bruvtab_mediator@example.org' in manifest['allowed_extensions']
        else:
            assert 'chrome-extension://bkifkhiemhgpnomgdcbcbkifekkecnhk/' in manifest['allowed_origins']
