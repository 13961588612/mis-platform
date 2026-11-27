using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;

public class Program {
  public static async Task<int> Main(string[] args) {
    var url = args[0];
    var ws = new ClientWebSocket();
    ws.Options.RemoteCertificateValidationCallback = (s, c, ch, e) => true;
    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
    try {
      await ws.ConnectAsync(new Uri(url), cts.Token);
      Console.WriteLine("OPEN " + ws.State);
      return 0;
    } catch (Exception ex) {
      Console.WriteLine("FAIL " + ex.GetBaseException().Message);
      return 1;
    } finally {
      ws.Dispose();
    }
  }
}
