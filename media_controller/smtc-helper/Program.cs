// smtc-helper — Windows System Media Transport Controls (SMTC) 브리지
//
// Stream Deck 플러그인(media_controller)의 windows.ts 가 out-of-process 로 실행한다.
//   smtc-helper get                          현재 곡 정보를 한 번 JSON 출력 (없으면 "null")
//   smtc-helper stream                       SMTC 변경 시마다 한 줄 JSON 출력 (stdin 닫히면 종료)
//   smtc-helper send <playpause|next|previous>   현재 세션에 제어 명령 전달
//
// 출력 payload 키: title, artist, album, playing(bool), artworkData(base64), artworkMimeType
//
// 빌드/vendor: ../scripts/build-smtc-helper.ps1
// ⚠️ 아직 Windows 에서 검증되지 않음 (코드/구조만 작성).

using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

using SessionManager = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager;
using Session = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;
using PlaybackStatus = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus;

internal static class Program
{
	private static async Task<int> Main(string[] args)
	{
		if (args.Length == 0)
		{
			Console.Error.WriteLine("usage: smtc-helper <get|stream|send> [command]");
			return 1;
		}

		SessionManager manager;
		try
		{
			manager = await SessionManager.RequestAsync();
		}
		catch (Exception ex)
		{
			Console.Error.WriteLine($"SMTC RequestAsync 실패: {ex.Message}");
			return 1;
		}

		switch (args[0])
		{
			case "get":
				Console.WriteLine(await GetJsonAsync(manager));
				return 0;
			case "send":
				return await SendAsync(manager, args.Length > 1 ? args[1] : string.Empty);
			case "stream":
				await StreamAsync(manager);
				return 0;
			default:
				Console.Error.WriteLine($"unknown command: {args[0]}");
				return 1;
		}
	}

	private static async Task<string> GetJsonAsync(SessionManager manager)
	{
		Session? session = manager.GetCurrentSession();
		if (session is null)
		{
			return "null";
		}

		try
		{
			GlobalSystemMediaTransportControlsSessionMediaProperties props = await session.TryGetMediaPropertiesAsync();
			GlobalSystemMediaTransportControlsSessionPlaybackInfo? playback = session.GetPlaybackInfo();
			bool playing = playback?.PlaybackStatus == PlaybackStatus.Playing;

			string? artworkData = null;
			string? artworkMimeType = null;
			if (props.Thumbnail is not null)
			{
				try
				{
					using IRandomAccessStreamWithContentType stream = await props.Thumbnail.OpenReadAsync();
					uint size = (uint)stream.Size;
					if (size > 0)
					{
						IBuffer buffer = await stream.ReadAsync(new Windows.Storage.Streams.Buffer(size), size, InputStreamOptions.None);
						artworkData = CryptographicBufferToBase64(buffer);
						artworkMimeType = string.IsNullOrEmpty(stream.ContentType) ? "image/jpeg" : stream.ContentType;
					}
				}
				catch
				{
					// 앨범아트는 선택사항 — 실패해도 곡 정보는 반환한다.
				}
			}

			var payload = new
			{
				title = props.Title ?? string.Empty,
				artist = props.Artist ?? string.Empty,
				album = props.AlbumTitle ?? string.Empty,
				playing,
				artworkData,
				artworkMimeType,
			};
			return JsonSerializer.Serialize(payload);
		}
		catch
		{
			return "null";
		}
	}

	private static string CryptographicBufferToBase64(IBuffer buffer)
	{
		byte[] bytes = new byte[buffer.Length];
		using DataReader reader = DataReader.FromBuffer(buffer);
		reader.ReadBytes(bytes);
		return Convert.ToBase64String(bytes);
	}

	private static async Task<int> SendAsync(SessionManager manager, string command)
	{
		Session? session = manager.GetCurrentSession();
		if (session is null)
		{
			Console.Error.WriteLine("활성 미디어 세션 없음");
			return 1;
		}

		try
		{
			switch (command)
			{
				case "playpause":
					await session.TryTogglePlayPauseAsync();
					return 0;
				case "next":
					await session.TrySkipNextAsync();
					return 0;
				case "previous":
					await session.TrySkipPreviousAsync();
					return 0;
				default:
					Console.Error.WriteLine($"unknown send command: {command}");
					return 1;
			}
		}
		catch (Exception ex)
		{
			Console.Error.WriteLine($"send 실패: {ex.Message}");
			return 1;
		}
	}

	private static async Task StreamAsync(SessionManager manager)
	{
		// WinRT 이벤트는 스레드풀에서 오므로, fetch+compare+write 와 attach/detach 를
		// 하나의 비동기 게이트(SemaphoreSlim)로 직렬화한다. (lock 은 await 구간을 보호하지 못한다.)
		SemaphoreSlim gate = new(1, 1);
		string lastLine = string.Empty;
		ManualResetEventSlim done = new(false);
		Session? attached = null;

		async Task EmitAsync()
		{
			await gate.WaitAsync();
			try
			{
				string line = await GetJsonAsync(manager);
				if (line == lastLine)
				{
					return; // 중복 억제
				}
				lastLine = line;
				Console.WriteLine(line);
			}
			catch
			{
				// 출력 파이프가 닫혔거나(부모 종료) 실패 — 정리하고 종료한다.
				done.Set();
			}
			finally
			{
				gate.Release();
			}
		}

		void Emit() => _ = EmitAsync();

		TypedEventHandler<Session, MediaPropertiesChangedEventArgs> onProps = (_, _) => Emit();
		TypedEventHandler<Session, PlaybackInfoChangedEventArgs> onPlayback = (_, _) => Emit();

		async Task AttachToAsync(Session? session)
		{
			await gate.WaitAsync();
			try
			{
				if (attached is not null)
				{
					attached.MediaPropertiesChanged -= onProps;
					attached.PlaybackInfoChanged -= onPlayback;
				}
				attached = session;
				if (attached is not null)
				{
					attached.MediaPropertiesChanged += onProps;
					attached.PlaybackInfoChanged += onPlayback;
				}
			}
			finally
			{
				gate.Release();
			}
		}

		manager.CurrentSessionChanged += (m, _) =>
		{
			Task.Run(async () =>
			{
				await AttachToAsync(m.GetCurrentSession());
				await EmitAsync();
			});
		};

		await AttachToAsync(manager.GetCurrentSession());
		await EmitAsync(); // 초기 상태

		// 부모(Node)가 abnormal 하게 죽으면 stdin 이 EOF — 그때 함께 종료(orphan 방지).
		Console.CancelKeyPress += (_, e) =>
		{
			e.Cancel = true;
			done.Set();
		};
		_ = Task.Run(() =>
		{
			try
			{
				while (Console.In.ReadLine() is not null)
				{
					// 입력은 쓰지 않는다 — EOF 감지용.
				}
			}
			catch
			{
				// ignore
			}
			done.Set();
		});

		done.Wait();
	}
}
