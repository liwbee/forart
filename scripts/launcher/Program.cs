using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

[DllImport("kernel32.dll", SetLastError = true)]
static extern bool AllocConsole();

[DllImport("kernel32.dll", SetLastError = true)]
static extern bool FreeConsole();

var appPath = Application.ExecutablePath;
var appDirectory = Path.GetDirectoryName(appPath) ?? AppContext.BaseDirectory;
var viteProcess = default(Process);
var electronProcess = default(Process);
var consoleVisible = true;

AllocConsole();
Console.OutputEncoding = Encoding.UTF8;
Console.InputEncoding = Encoding.UTF8;
Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
Console.SetError(new StreamWriter(Console.OpenStandardError()) { AutoFlush = true });
Console.Title = "Forart starting";

try
{
    Log("Forart launcher");
    Log($"Working directory: {appDirectory}");
    EnsureFile(Path.Combine(appDirectory, "package.json"), "package.json was not found. Put Forart.exe in the project root.");

    Log("Checking Node.js...");
    await RunVisibleCommand("node --version", appDirectory);

    Log("Checking npm...");
    await RunVisibleCommand("npm --version", appDirectory);

    if (!Directory.Exists(Path.Combine(appDirectory, "node_modules")))
    {
        Log("node_modules was not found. Installing dependencies...");
        await RunVisibleCommand("npm install", appDirectory);
    }
    else
    {
        Log("Dependencies found. Skipping npm install.");
    }

    Log("Starting frontend dev server...");
    viteProcess = StartBackgroundCommand("npm run dev:web", appDirectory, "vite", () => consoleVisible);
    await WaitForHttpReady("http://127.0.0.1:5174", TimeSpan.FromSeconds(45), viteProcess);
    Log("Frontend server is ready.");

    Log("Opening Forart window...");
    consoleVisible = false;
    FreeConsole();

    electronProcess = StartBackgroundCommand("npm run electron", appDirectory, "electron", () => false);
    await EnsureProcessKeepsRunning(electronProcess, TimeSpan.FromSeconds(3));
    await electronProcess.WaitForExitAsync();
    StopProcess(viteProcess);
    return electronProcess.ExitCode;
}
catch (Exception error)
{
    StopProcess(electronProcess);
    StopProcess(viteProcess);

    if (consoleVisible)
    {
        Log("");
        Log("[ERROR] Startup failed");
        Log(error.Message);
        Log("");
        Log("Press any key to close this window.");
        Console.ReadKey(intercept: true);
    }
    else
    {
        MessageBox.Show(
            error.Message,
            "Forart startup failed",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }
    return 1;
}

static void EnsureFile(string path, string message)
{
    if (!File.Exists(path)) throw new FileNotFoundException(message, path);
}

static void Log(string message)
{
    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {message}");
}

static async Task RunVisibleCommand(string command, string workingDirectory)
{
    using var process = Process.Start(new ProcessStartInfo
    {
        FileName = "cmd.exe",
        Arguments = $"/c {command}",
        WorkingDirectory = workingDirectory,
        UseShellExecute = false,
        CreateNoWindow = false,
    }) ?? throw new InvalidOperationException($"Could not start command: {command}");

    await process.WaitForExitAsync();
    if (process.ExitCode != 0) throw new InvalidOperationException($"Command failed: {command} (exit code {process.ExitCode})");
}

static Process StartBackgroundCommand(string command, string workingDirectory, string label, Func<bool> shouldLog)
{
    var process = new Process
    {
        StartInfo = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c {command}",
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        },
        EnableRaisingEvents = true,
    };
    process.OutputDataReceived += (_, eventArgs) =>
    {
        if (eventArgs.Data != null && shouldLog()) Console.WriteLine($"[{label}] {eventArgs.Data}");
    };
    process.ErrorDataReceived += (_, eventArgs) =>
    {
        if (eventArgs.Data != null && shouldLog()) Console.Error.WriteLine($"[{label}] {eventArgs.Data}");
    };
    if (!process.Start()) throw new InvalidOperationException($"Could not start command: {command}");
    process.BeginOutputReadLine();
    process.BeginErrorReadLine();
    return process;
}

static async Task WaitForHttpReady(string url, TimeSpan timeout, Process process)
{
    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
    var deadline = DateTime.UtcNow + timeout;
    Exception? lastError = null;

    while (DateTime.UtcNow < deadline)
    {
        if (process.HasExited) throw new InvalidOperationException($"Frontend server exited with code {process.ExitCode}.");
        try
        {
            using var response = await client.GetAsync(url);
            if ((int)response.StatusCode < 500) return;
        }
        catch (Exception error)
        {
            lastError = error;
        }
        await Task.Delay(800);
    }

    throw new TimeoutException($"Timed out waiting for frontend server: {url}. {lastError?.Message}");
}

static async Task EnsureProcessKeepsRunning(Process process, TimeSpan duration)
{
    var exitTask = process.WaitForExitAsync();
    var finished = await Task.WhenAny(exitTask, Task.Delay(duration));
    if (finished != exitTask) return;
    throw new InvalidOperationException($"Forart exited immediately with code {process.ExitCode}.");
}

static void StopProcess(Process? process)
{
    if (process == null) return;
    try
    {
        if (!process.HasExited) process.Kill(entireProcessTree: true);
    }
    catch
    {
        // Best-effort cleanup during shutdown.
    }
    finally
    {
        process.Dispose();
    }
}
