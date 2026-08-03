using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string launcherDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            DirectoryInfo launcherParent = Directory.GetParent(launcherDir);
            DirectoryInfo repoInfo = launcherParent != null ? Directory.GetParent(launcherParent.FullName) : null;
            string repoRoot = repoInfo != null ? repoInfo.FullName : "";
            string packageJson = Path.Combine(repoRoot, "package.json");
            string electronExe = Path.Combine(repoRoot, "node_modules", "electron", "dist", "electron.exe");

            if (!File.Exists(packageJson))
            {
                MessageBox.Show(
                    "找不到 SeMa 仓库根目录（package.json）。请确认 launcher/windows 仍在仓库内。",
                    "SeMa",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            if (!File.Exists(electronExe))
            {
                MessageBox.Show(
                    "未安装依赖。请在仓库根目录执行：npm install",
                    "SeMa",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            var psi = new ProcessStartInfo
            {
                FileName = electronExe,
                Arguments = "\"" + repoRoot + "\"",
                WorkingDirectory = repoRoot,
                UseShellExecute = false
            };
            Process.Start(psi);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "启动失败：\n" + ex.Message,
                "SeMa",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 1;
        }
    }
}
