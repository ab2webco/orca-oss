using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class OrcaCliLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            string launcherDirectory = Path.GetDirectoryName(typeof(OrcaCliLauncher).Assembly.Location);
            string resourcesDirectory = Directory.GetParent(launcherDirectory).FullName;
            string appDirectory = Directory.GetParent(resourcesDirectory).FullName;
            string electronPath = ResolveElectronPath(appDirectory);
            string cliPath = Path.Combine(
                resourcesDirectory,
                "app.asar.unpacked",
                "out",
                "cli",
                "index.js"
            );

            if (electronPath == null)
            {
                Console.Error.WriteLine("Unable to locate the Orca executable next to \"{0}\"", resourcesDirectory);
                return 1;
            }

            if (!File.Exists(cliPath))
            {
                Console.Error.WriteLine("Unable to locate the Orca CLI entrypoint at \"{0}\"", cliPath);
                return 1;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = electronPath,
                Arguments = BuildArguments(cliPath, args),
                UseShellExecute = false
            };

            // Why: launching without cmd.exe preserves embedded newlines while matching the
            // packaged batch launcher's Electron-as-Node environment contract.
            // Why: ProcessStartInfo's env copy rejects duplicate PATH/Path keys; mutating this
            // short-lived process preserves the native block for child inheritance (#12046).
            MoveEnvironmentVariable("NODE_OPTIONS", "ORCA_NODE_OPTIONS");
            MoveEnvironmentVariable("NODE_REPL_EXTERNAL_MODULE", "ORCA_NODE_REPL_EXTERNAL_MODULE");
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "1");
            Environment.SetEnvironmentVariable("ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER", "1");
            string requestedCliCommand = Environment.GetEnvironmentVariable("ORCA_CLI_COMMAND");
            Environment.SetEnvironmentVariable(
                "ORCA_CLI_COMMAND",
                requestedCliCommand == "orca-ide" ? "orca-ide" : "orca"
            );

            using (Process child = Process.Start(startInfo))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Unable to start the Orca CLI: {0}", error.Message);
            return 1;
        }
    }

    // Why globbed: the packaged exe is named after productName, so a rename must not orphan the CLI.
    private static string ResolveElectronPath(string appDirectory)
    {
        string[] branded = Directory.GetFiles(appDirectory, "Orca*.exe", SearchOption.TopDirectoryOnly);
        if (branded.Length == 1)
        {
            return branded[0];
        }

        string[] every = Directory.GetFiles(appDirectory, "*.exe", SearchOption.TopDirectoryOnly);
        return every.Length == 1 ? every[0] : null;
    }

    private static void MoveEnvironmentVariable(string sourceName, string targetName)
    {
        string value = Environment.GetEnvironmentVariable(sourceName);
        Environment.SetEnvironmentVariable(sourceName, null);
        // Why: a null value clears the target, matching the previous unconditional Remove.
        Environment.SetEnvironmentVariable(targetName, value);
    }

    private static string BuildArguments(string cliPath, string[] args)
    {
        StringBuilder commandLine = new StringBuilder(QuoteArgument(cliPath));
        foreach (string arg in args)
        {
            commandLine.Append(' ');
            commandLine.Append(QuoteArgument(arg));
        }
        return commandLine.ToString();
    }

    private static string QuoteArgument(string value)
    {
        bool requiresQuotes = value.Length == 0;
        for (int index = 0; index < value.Length && !requiresQuotes; index += 1)
        {
            requiresQuotes = value[index] == '"' || Char.IsWhiteSpace(value[index]);
        }
        if (!requiresQuotes)
        {
            return value;
        }

        StringBuilder quoted = new StringBuilder("\"");
        int backslashCount = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashCount += 1;
                continue;
            }

            if (character == '"')
            {
                quoted.Append('\\', backslashCount * 2 + 1);
                quoted.Append('"');
            }
            else
            {
                quoted.Append('\\', backslashCount);
                quoted.Append(character);
            }
            backslashCount = 0;
        }

        quoted.Append('\\', backslashCount * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
