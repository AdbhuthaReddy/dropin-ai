import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("demo_serve", Path(__file__).resolve().parents[2] / "deploy" / "serve.py")
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)


class DemoContainerTests(unittest.TestCase):
    def children(self):
        children = [Mock(pid=value, returncode=0) for value in (101, 102, 103)]
        for child in children:
            child.poll.return_value = None
        return children

    def test_shutdown_terminates_all_three_processes_and_configures_ports(self):
        children = self.children()
        with patch.object(serve.signal, "signal"), \
                patch.object(serve.subprocess, "Popen", side_effect=children) as start, \
                patch.object(serve.time, "sleep", side_effect=SystemExit(0)):
            with self.assertRaises(SystemExit):
                serve.main()
        self.assertIn("8081", start.call_args_list[0].args[0])
        self.assertEqual(start.call_args_list[1].kwargs["env"]["PORT"], "3000")
        self.assertIn("/app/nginx.conf", start.call_args_list[2].args[0])
        for child in children:
            child.terminate.assert_called_once()
            child.wait.assert_called_once()

    def test_child_exit_fails_container_and_cleans_up_peers(self):
        children = self.children()
        children[1].poll.return_value = 1
        children[1].returncode = 1
        with patch.object(serve.signal, "signal"), patch.object(serve.subprocess, "Popen", side_effect=children):
            with self.assertRaisesRegex(RuntimeError, "102 exited with code 1"):
                serve.main()
        children[0].terminate.assert_called_once()
        children[2].terminate.assert_called_once()

    def test_unresponsive_child_is_killed_during_shutdown(self):
        children = self.children()
        children[0].wait.side_effect = [subprocess.TimeoutExpired("fixture", 5), 0]
        with patch.object(serve.signal, "signal"), patch.object(serve.subprocess, "Popen", side_effect=children), \
                patch.object(serve.time, "sleep", side_effect=SystemExit(0)):
            with self.assertRaises(SystemExit):
                serve.main()
        children[0].kill.assert_called_once()
