using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace IvacToolkitNativeHost
{
    public sealed class FileMeta
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public long Size { get; set; }
        public long LastModified { get; set; }
        public int Chunks { get; set; }
    }

    public sealed class VaultState
    {
        public string Phone { get; set; }
        public string Password { get; set; }
        public bool AutoSubmit { get; set; }
        public List<FileMeta> Files { get; set; }

        public VaultState()
        {
            Phone = string.Empty;
            Password = string.Empty;
            AutoSubmit = true;
            Files = new List<FileMeta>();
        }
    }

    public sealed class VaultPaths
    {
        public string VaultId { get; private set; }
        public string Root { get; private set; }
        public string FilesRoot { get; private set; }
        public string StatePath { get; private set; }
        public string KeyPath { get; private set; }

        public VaultPaths(string vaultId, string profilesRoot)
        {
            VaultId = vaultId;
            Root = Path.Combine(profilesRoot, vaultId);
            FilesRoot = Path.Combine(Root, "files");
            StatePath = Path.Combine(Root, "state.dat");
            KeyPath = Path.Combine(Root, "master-key.dat");

            Directory.CreateDirectory(Root);
            Directory.CreateDirectory(FilesRoot);
        }
    }

    public static class Program
    {
        private const int MaxIncomingMessage = 64 * 1024 * 1024;
        private const int ChunkSize = 512 * 1024;
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("IVAC TOOLKIT VAULT v1");
        private static readonly string VaultRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "IVACToolkit",
            "Vault"
        );
        private static readonly string ProfilesRoot = Path.Combine(VaultRoot, "profiles");
        private static readonly Mutex VaultMutex = new Mutex(false, "Local\\IVACToolkitVaultMutexV1");

        public static int Main(string[] args)
        {
            try
            {
                Directory.CreateDirectory(VaultRoot);
                Directory.CreateDirectory(ProfilesRoot);

                Stream input = Console.OpenStandardInput();
                Stream output = Console.OpenStandardOutput();

                while (true)
                {
                    byte[] lengthBytes = ReadExactOrEof(input, 4);
                    if (lengthBytes == null)
                    {
                        return 0;
                    }

                    int length = BitConverter.ToInt32(lengthBytes, 0);
                    if (length < 0 || length > MaxIncomingMessage)
                    {
                        WriteResponse(output, Error("Invalid native message length."));
                        return 2;
                    }

                    byte[] payload = ReadExact(input, length);
                    string jsonText = Encoding.UTF8.GetString(payload);
                    Dictionary<string, object> request = Json.Deserialize<Dictionary<string, object>>(jsonText);
                    Dictionary<string, object> response;

                    bool locked = false;
                    try
                    {
                        locked = VaultMutex.WaitOne(TimeSpan.FromSeconds(15));
                        if (!locked)
                        {
                            response = Error("Windows vault is busy. Try again.");
                        }
                        else
                        {
                            response = Handle(request);
                        }
                    }
                    catch (AbandonedMutexException)
                    {
                        locked = true;
                        response = Handle(request);
                    }
                    catch (Exception ex)
                    {
                        response = Error(ex.Message);
                    }
                    finally
                    {
                        if (locked)
                        {
                            try { VaultMutex.ReleaseMutex(); } catch { }
                        }
                    }

                    object requestId;
                    if (request != null && request.TryGetValue("requestId", out requestId))
                    {
                        response["requestId"] = requestId;
                    }

                    WriteResponse(output, response);
                }
            }
            catch (Exception ex)
            {
                try
                {
                    Console.Error.WriteLine(ex.ToString());
                }
                catch { }

                return 1;
            }
        }

        private static Dictionary<string, object> Handle(Dictionary<string, object> request)
        {
            string action = GetString(request, "action");

            switch (action)
            {
                case "ping":
                    return Ok();

                case "allocateVaultId":
                    return AllocateVaultId();

                case "vaultExists":
                    return VaultExists(request);

                case "getState":
                    return GetStateResponse(request);

                case "getSettings":
                    return GetSettingsResponse(request);

                case "saveSettings":
                    return SaveSettings(request);

                case "beginFile":
                    return BeginFile(request);

                case "putFileChunk":
                    return PutFileChunk(request);

                case "commitFile":
                    return CommitFile(request);

                case "cancelFile":
                    return CancelFile(request);

                case "deleteFile":
                    return DeleteFile(request);

                case "clearFiles":
                    return ClearFiles(request);

                case "reorderFiles":
                    return ReorderFiles(request);

                case "readFileChunk":
                    return ReadFileChunk(request);

                default:
                    return Error("Unknown action.");
            }
        }

        private static Dictionary<string, object> GetStateResponse(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            VaultState state = LoadState(paths);
            Dictionary<string, object> response = Ok();
            response["settings"] = SettingsDictionary(state);
            response["files"] = state.Files.Select(FileDictionary).ToList();
            response["vaultId"] = paths.VaultId;
            return response;
        }

        private static Dictionary<string, object> GetSettingsResponse(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            VaultState state = LoadState(paths);
            Dictionary<string, object> response = Ok();
            response["settings"] = SettingsDictionary(state);
            response["vaultId"] = paths.VaultId;
            return response;
        }

        private static Dictionary<string, object> SaveSettings(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            VaultState state = LoadState(paths);
            state.Phone = GetString(request, "phone");
            state.Password = GetString(request, "password");
            state.AutoSubmit = GetBool(request, "autoSubmit", true);
            SaveState(paths, state);

            Dictionary<string, object> response = Ok();
            response["settings"] = SettingsDictionary(state);
            response["vaultId"] = paths.VaultId;
            return response;
        }

        private static Dictionary<string, object> BeginFile(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            string id = RequireGuid(request, "id");
            long size = GetLong(request, "size", 0);
            if (size < 0)
            {
                throw new InvalidOperationException("Invalid file size.");
            }

            VaultState state = LoadState(paths);
            if (state.Files.Any(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException("File id already exists.");
            }

            string dir = FileDirectory(paths, id);
            if (Directory.Exists(dir))
            {
                Directory.Delete(dir, true);
            }

            Directory.CreateDirectory(dir);

            FileMeta meta = new FileMeta
            {
                Id = id,
                Name = GetString(request, "name"),
                Type = GetString(request, "type"),
                Size = size,
                LastModified = GetLong(request, "lastModified", 0),
                Chunks = 0
            };

            if (string.IsNullOrWhiteSpace(meta.Name))
            {
                throw new InvalidOperationException("File name is required.");
            }

            if (string.IsNullOrWhiteSpace(meta.Type))
            {
                meta.Type = "application/pdf";
            }

            SaveProtectedObject(Path.Combine(dir, "pending.dat"), meta);
            return Ok();
        }

        private static Dictionary<string, object> PutFileChunk(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            string id = RequireGuid(request, "id");
            int index = GetInt(request, "index", -1);
            if (index < 0 || index > 1000000)
            {
                throw new InvalidOperationException("Invalid chunk index.");
            }

            string dir = FileDirectory(paths, id);
            string pending = Path.Combine(dir, "pending.dat");
            if (!File.Exists(pending))
            {
                throw new InvalidOperationException("Pending file was not initialized.");
            }

            string encoded = GetString(request, "data");
            byte[] plain;
            try
            {
                plain = Convert.FromBase64String(encoded);
            }
            catch
            {
                throw new InvalidOperationException("Invalid chunk data.");
            }

            if (plain.Length > ChunkSize)
            {
                throw new InvalidOperationException("Chunk is too large.");
            }

            byte[] encrypted = EncryptChunk(paths, plain);
            File.WriteAllBytes(ChunkPath(paths, id, index), encrypted);
            return Ok();
        }

        private static Dictionary<string, object> CommitFile(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            string id = RequireGuid(request, "id");
            string dir = FileDirectory(paths, id);
            string pending = Path.Combine(dir, "pending.dat");

            if (!File.Exists(pending))
            {
                throw new InvalidOperationException("Pending file metadata was not found.");
            }

            FileMeta meta = LoadProtectedObject<FileMeta>(pending);
            int expected = meta.Size == 0
                ? 0
                : checked((int)((meta.Size + ChunkSize - 1) / ChunkSize));

            for (int i = 0; i < expected; i++)
            {
                if (!File.Exists(ChunkPath(paths, id, i)))
                {
                    throw new InvalidOperationException("A file chunk is missing.");
                }
            }

            string[] chunkFiles = Directory.GetFiles(dir, "*.bin");
            if (chunkFiles.Length != expected)
            {
                throw new InvalidOperationException("Unexpected file chunk count.");
            }

            meta.Chunks = expected;

            VaultState state = LoadState(paths);
            state.Files.RemoveAll(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase));
            state.Files.Add(meta);
            SaveState(paths, state);

            File.Delete(pending);

            Dictionary<string, object> response = Ok();
            response["file"] = FileDictionary(meta);
            return response;
        }

        private static Dictionary<string, object> CancelFile(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            string id = RequireGuid(request, "id");
            VaultState state = LoadState(paths);
            bool committed = state.Files.Any(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase));

            if (!committed)
            {
                string dir = FileDirectory(paths, id);
                if (Directory.Exists(dir))
                {
                    Directory.Delete(dir, true);
                }
            }

            return Ok();
        }

        private static Dictionary<string, object> DeleteFile(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            string id = RequireGuid(request, "id");
            VaultState state = LoadState(paths);
            state.Files.RemoveAll(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase));
            SaveState(paths, state);

            string dir = FileDirectory(paths, id);
            if (Directory.Exists(dir))
            {
                Directory.Delete(dir, true);
            }

            return Ok();
        }

        private static Dictionary<string, object> ClearFiles(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            VaultState state = LoadState(paths);
            state.Files.Clear();
            SaveState(paths, state);

            if (Directory.Exists(paths.FilesRoot))
            {
                Directory.Delete(paths.FilesRoot, true);
            }
            Directory.CreateDirectory(paths.FilesRoot);

            return Ok();
        }

        private static Dictionary<string, object> ReorderFiles(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            List<string> ids = GetStringList(request, "ids");
            VaultState state = LoadState(paths);

            Dictionary<string, FileMeta> byId = state.Files.ToDictionary(
                x => x.Id,
                x => x,
                StringComparer.OrdinalIgnoreCase
            );

            List<FileMeta> ordered = new List<FileMeta>();
            foreach (string id in ids)
            {
                FileMeta meta;
                if (byId.TryGetValue(id, out meta))
                {
                    ordered.Add(meta);
                    byId.Remove(id);
                }
            }

            foreach (FileMeta remaining in state.Files)
            {
                if (byId.ContainsKey(remaining.Id))
                {
                    ordered.Add(remaining);
                    byId.Remove(remaining.Id);
                }
            }

            state.Files = ordered;
            SaveState(paths, state);
            return Ok();
        }

        private static Dictionary<string, object> ReadFileChunk(Dictionary<string, object> request)
        {
            VaultPaths paths = GetVaultPaths(request);
            string id = RequireGuid(request, "id");
            int index = GetInt(request, "index", -1);
            VaultState state = LoadState(paths);
            FileMeta meta = state.Files.FirstOrDefault(
                x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase)
            );

            if (meta == null)
            {
                throw new InvalidOperationException("Saved file was not found.");
            }

            if (index < 0 || index >= meta.Chunks)
            {
                throw new InvalidOperationException("Invalid saved chunk index.");
            }

            string path = ChunkPath(paths, id, index);
            if (!File.Exists(path))
            {
                throw new InvalidOperationException("Saved file chunk is missing.");
            }

            byte[] plain = DecryptChunk(paths, File.ReadAllBytes(path));

            Dictionary<string, object> response = Ok();
            response["data"] = Convert.ToBase64String(plain);
            response["index"] = index;
            response["chunks"] = meta.Chunks;
            return response;
        }

        private static VaultState LoadState(VaultPaths paths)
        {
            if (!File.Exists(paths.StatePath))
            {
                return new VaultState();
            }

            try
            {
                byte[] protectedBytes = File.ReadAllBytes(paths.StatePath);
                byte[] plain = ProtectedData.Unprotect(
                    protectedBytes,
                    Entropy,
                    DataProtectionScope.CurrentUser
                );
                VaultState state = Json.Deserialize<VaultState>(Encoding.UTF8.GetString(plain));

                if (state == null)
                {
                    state = new VaultState();
                }
                if (state.Files == null)
                {
                    state.Files = new List<FileMeta>();
                }
                if (state.Phone == null)
                {
                    state.Phone = string.Empty;
                }
                if (state.Password == null)
                {
                    state.Password = string.Empty;
                }

                return state;
            }
            catch (CryptographicException)
            {
                throw new InvalidOperationException(
                    "Windows could not decrypt the vault for this user account."
                );
            }
        }

        private static void SaveState(VaultPaths paths, VaultState state)
        {
            string json = Json.Serialize(state);
            byte[] plain = Encoding.UTF8.GetBytes(json);
            byte[] protectedBytes = ProtectedData.Protect(
                plain,
                Entropy,
                DataProtectionScope.CurrentUser
            );
            WriteAtomically(paths.StatePath, protectedBytes);
        }

        private static void SaveProtectedObject<T>(string path, T value)
        {
            byte[] plain = Encoding.UTF8.GetBytes(Json.Serialize(value));
            byte[] protectedBytes = ProtectedData.Protect(
                plain,
                Entropy,
                DataProtectionScope.CurrentUser
            );
            WriteAtomically(path, protectedBytes);
        }

        private static T LoadProtectedObject<T>(string path)
        {
            byte[] protectedBytes = File.ReadAllBytes(path);
            byte[] plain = ProtectedData.Unprotect(
                protectedBytes,
                Entropy,
                DataProtectionScope.CurrentUser
            );
            return Json.Deserialize<T>(Encoding.UTF8.GetString(plain));
        }

        private static byte[] GetMasterKey(VaultPaths paths)
        {
            if (File.Exists(paths.KeyPath))
            {
                try
                {
                    return ProtectedData.Unprotect(
                        File.ReadAllBytes(paths.KeyPath),
                        Entropy,
                        DataProtectionScope.CurrentUser
                    );
                }
                catch (CryptographicException)
                {
                    throw new InvalidOperationException(
                        "Windows could not unlock the PDF encryption key."
                    );
                }
            }

            byte[] key = new byte[32];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(key);
            }

            byte[] protectedKey = ProtectedData.Protect(
                key,
                Entropy,
                DataProtectionScope.CurrentUser
            );
            WriteAtomically(paths.KeyPath, protectedKey);
            return key;
        }

        private static byte[] EncryptChunk(VaultPaths paths, byte[] plain)
        {
            byte[] master = GetMasterKey(paths);
            byte[] encKey = DeriveKey(master, "enc");
            byte[] macKey = DeriveKey(master, "mac");

            using (Aes aes = Aes.Create())
            {
                aes.KeySize = 256;
                aes.BlockSize = 128;
                aes.Mode = CipherMode.CBC;
                aes.Padding = PaddingMode.PKCS7;
                aes.Key = encKey;
                aes.GenerateIV();

                byte[] cipher;
                using (ICryptoTransform encryptor = aes.CreateEncryptor())
                {
                    cipher = encryptor.TransformFinalBlock(plain, 0, plain.Length);
                }

                byte[] body = new byte[aes.IV.Length + cipher.Length];
                Buffer.BlockCopy(aes.IV, 0, body, 0, aes.IV.Length);
                Buffer.BlockCopy(cipher, 0, body, aes.IV.Length, cipher.Length);

                byte[] mac;
                using (HMACSHA256 hmac = new HMACSHA256(macKey))
                {
                    mac = hmac.ComputeHash(body);
                }

                byte[] result = new byte[body.Length + mac.Length];
                Buffer.BlockCopy(body, 0, result, 0, body.Length);
                Buffer.BlockCopy(mac, 0, result, body.Length, mac.Length);
                return result;
            }
        }

        private static byte[] DecryptChunk(VaultPaths paths, byte[] encrypted)
        {
            if (encrypted == null || encrypted.Length < 16 + 16 + 32)
            {
                throw new InvalidOperationException("Encrypted PDF chunk is invalid.");
            }

            byte[] master = GetMasterKey(paths);
            byte[] encKey = DeriveKey(master, "enc");
            byte[] macKey = DeriveKey(master, "mac");

            int macOffset = encrypted.Length - 32;
            byte[] body = new byte[macOffset];
            byte[] storedMac = new byte[32];
            Buffer.BlockCopy(encrypted, 0, body, 0, body.Length);
            Buffer.BlockCopy(encrypted, macOffset, storedMac, 0, 32);

            byte[] calculatedMac;
            using (HMACSHA256 hmac = new HMACSHA256(macKey))
            {
                calculatedMac = hmac.ComputeHash(body);
            }

            if (!FixedTimeEquals(storedMac, calculatedMac))
            {
                throw new InvalidOperationException("Encrypted PDF chunk failed integrity validation.");
            }

            byte[] iv = new byte[16];
            Buffer.BlockCopy(body, 0, iv, 0, 16);
            byte[] cipher = new byte[body.Length - 16];
            Buffer.BlockCopy(body, 16, cipher, 0, cipher.Length);

            using (Aes aes = Aes.Create())
            {
                aes.KeySize = 256;
                aes.BlockSize = 128;
                aes.Mode = CipherMode.CBC;
                aes.Padding = PaddingMode.PKCS7;
                aes.Key = encKey;
                aes.IV = iv;

                using (ICryptoTransform decryptor = aes.CreateDecryptor())
                {
                    return decryptor.TransformFinalBlock(cipher, 0, cipher.Length);
                }
            }
        }

        private static byte[] DeriveKey(byte[] master, string label)
        {
            byte[] labelBytes = Encoding.UTF8.GetBytes(label);
            byte[] combined = new byte[master.Length + labelBytes.Length];
            Buffer.BlockCopy(master, 0, combined, 0, master.Length);
            Buffer.BlockCopy(labelBytes, 0, combined, master.Length, labelBytes.Length);

            using (SHA256 sha = SHA256.Create())
            {
                return sha.ComputeHash(combined);
            }
        }

        private static bool FixedTimeEquals(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length)
            {
                return false;
            }

            int diff = 0;
            for (int i = 0; i < a.Length; i++)
            {
                diff |= a[i] ^ b[i];
            }
            return diff == 0;
        }

        private static string NormalizeVaultId(string raw)
        {
            if (!string.IsNullOrEmpty(raw) && raw.All(c => c >= '0' && c <= '9') && raw[0] != '0')
            {
                long numericId;
                if (long.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out numericId) && numericId > 0)
                {
                    return numericId.ToString(CultureInfo.InvariantCulture);
                }
            }

            Guid guid;
            if (Guid.TryParse(raw, out guid))
            {
                return guid.ToString("D").ToLowerInvariant();
            }

            throw new InvalidOperationException("A valid numeric vault ID or legacy UUID is required.");
        }

        private static Dictionary<string, object> VaultExists(Dictionary<string, object> request)
        {
            string id = NormalizeVaultId(GetString(request, "lookupVaultId"));
            Dictionary<string, object> response = Ok();
            response["exists"] = Directory.Exists(Path.Combine(ProfilesRoot, id));
            return response;
        }

        private static Dictionary<string, object> AllocateVaultId()
        {
            // Called under the cross-process mutex in Main.
            // A durable counter prevents reuse even after vault deletion.
            string counterPath = Path.Combine(VaultRoot, "next-profile-id.txt");
            long next = 1;
            if (File.Exists(counterPath))
            {
                if (!long.TryParse(File.ReadAllText(counterPath).Trim(), NumberStyles.None,
                    CultureInfo.InvariantCulture, out next) || next < 1)
                {
                    throw new InvalidOperationException("Profile ID counter is damaged; restore next-profile-id.txt from backup.");
                }
            }

            foreach (string directory in Directory.GetDirectories(ProfilesRoot))
            {
                long existing;
                if (long.TryParse(Path.GetFileName(directory), NumberStyles.None,
                    CultureInfo.InvariantCulture, out existing) && existing >= next)
                {
                    if (existing == long.MaxValue) throw new InvalidOperationException("Profile ID limit reached.");
                    next = existing + 1;
                }
            }

            if (next == long.MaxValue) throw new InvalidOperationException("Profile ID limit reached.");
            string id = next.ToString(CultureInfo.InvariantCulture);
            // Reserve the directory before publishing the updated counter.
            Directory.CreateDirectory(Path.Combine(ProfilesRoot, id));
            WriteAtomically(counterPath, Encoding.UTF8.GetBytes((next + 1).ToString(CultureInfo.InvariantCulture)));

            Dictionary<string, object> response = Ok();
            response["vaultId"] = id;
            return response;
        }

        private static VaultPaths GetVaultPaths(Dictionary<string, object> request)
        {
            string id = NormalizeVaultId(GetString(request, "vaultId"));
            return new VaultPaths(id, ProfilesRoot);
        }

        private static string FileDirectory(VaultPaths paths, string id)
        {
            return Path.Combine(paths.FilesRoot, id.ToLowerInvariant());
        }

        private static string ChunkPath(VaultPaths paths, string id, int index)
        {
            return Path.Combine(
                FileDirectory(paths, id),
                index.ToString("D8", CultureInfo.InvariantCulture) + ".bin"
            );
        }

        private static void WriteAtomically(string path, byte[] data)
        {
            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            string temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllBytes(temp, data);

            if (File.Exists(path))
            {
                string backup = path + ".bak";
                try
                {
                    File.Replace(temp, path, backup, true);
                    if (File.Exists(backup))
                    {
                        File.Delete(backup);
                    }
                    return;
                }
                catch
                {
                    if (File.Exists(backup))
                    {
                        try { File.Delete(backup); } catch { }
                    }
                    try { File.Delete(path); } catch { }
                }
            }

            File.Move(temp, path);
        }

        private static Dictionary<string, object> SettingsDictionary(VaultState state)
        {
            return new Dictionary<string, object>
            {
                { "phone", state.Phone ?? string.Empty },
                { "password", state.Password ?? string.Empty },
                { "autoSubmit", state.AutoSubmit }
            };
        }

        private static Dictionary<string, object> FileDictionary(FileMeta meta)
        {
            return new Dictionary<string, object>
            {
                { "id", meta.Id },
                { "name", meta.Name },
                { "type", meta.Type },
                { "size", meta.Size },
                { "lastModified", meta.LastModified },
                { "chunks", meta.Chunks }
            };
        }

        private static Dictionary<string, object> Ok()
        {
            return new Dictionary<string, object>
            {
                { "ok", true }
            };
        }

        private static Dictionary<string, object> Error(string message)
        {
            return new Dictionary<string, object>
            {
                { "ok", false },
                { "error", string.IsNullOrWhiteSpace(message) ? "Unknown error." : message }
            };
        }

        private static string GetString(Dictionary<string, object> values, string key)
        {
            object value;
            if (!values.TryGetValue(key, out value) || value == null)
            {
                return string.Empty;
            }
            return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        }

        private static long GetLong(Dictionary<string, object> values, string key, long fallback)
        {
            object value;
            if (!values.TryGetValue(key, out value) || value == null)
            {
                return fallback;
            }

            try
            {
                return Convert.ToInt64(value, CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        private static int GetInt(Dictionary<string, object> values, string key, int fallback)
        {
            long value = GetLong(values, key, fallback);
            if (value < int.MinValue || value > int.MaxValue)
            {
                return fallback;
            }
            return (int)value;
        }

        private static bool GetBool(Dictionary<string, object> values, string key, bool fallback)
        {
            object value;
            if (!values.TryGetValue(key, out value) || value == null)
            {
                return fallback;
            }

            if (value is bool)
            {
                return (bool)value;
            }

            bool parsed;
            if (bool.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out parsed))
            {
                return parsed;
            }
            return fallback;
        }

        private static string RequireGuid(Dictionary<string, object> values, string key)
        {
            string raw = GetString(values, key);
            Guid guid;
            if (!Guid.TryParse(raw, out guid))
            {
                throw new InvalidOperationException("Invalid file id.");
            }
            return guid.ToString("D");
        }

        private static List<string> GetStringList(Dictionary<string, object> values, string key)
        {
            object raw;
            List<string> result = new List<string>();

            if (!values.TryGetValue(key, out raw) || raw == null)
            {
                return result;
            }

            IEnumerable enumerable = raw as IEnumerable;
            if (enumerable == null || raw is string)
            {
                return result;
            }

            foreach (object item in enumerable)
            {
                if (item == null) continue;
                string text = Convert.ToString(item, CultureInfo.InvariantCulture);
                Guid guid;
                if (Guid.TryParse(text, out guid))
                {
                    result.Add(guid.ToString("D"));
                }
            }

            return result;
        }

        private static byte[] ReadExactOrEof(Stream input, int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;

            while (offset < count)
            {
                int read = input.Read(buffer, offset, count - offset);
                if (read == 0)
                {
                    if (offset == 0)
                    {
                        return null;
                    }
                    throw new EndOfStreamException("Unexpected end of native message.");
                }
                offset += read;
            }

            return buffer;
        }

        private static byte[] ReadExact(Stream input, int count)
        {
            byte[] result = ReadExactOrEof(input, count);
            if (result == null)
            {
                throw new EndOfStreamException("Unexpected end of native message.");
            }
            return result;
        }

        private static void WriteResponse(Stream output, Dictionary<string, object> response)
        {
            string json = Json.Serialize(response);
            byte[] payload = Encoding.UTF8.GetBytes(json);
            byte[] length = BitConverter.GetBytes(payload.Length);

            output.Write(length, 0, length.Length);
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }
    }
}
