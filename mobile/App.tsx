// CMA Office for Android: the same app as the website, inside a native shell.
// What the shell adds, because a website cannot do it:
//  - "wifi":   which WiFi router the phone is on (its MAC ID), for check in / check out
//  - "selfie": a front-camera selfie + the phone's GPS, for selfie attendance
//  - "track":  start / stop live location while checked in (after a full-screen notice the person agrees to;
//              a notification shows the whole time; see locationTask.ts)
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { CONSENT_KEY, startSharing, stopSharing } from "./locationTask";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

const KEY = "cma_office_url";

/** "187.1.2.3:3000" -> "http://187.1.2.3:3000"; names without a scheme get https. */
function cleanUrl(v: string) {
  const s = v.trim().replace(/\/+$/, "");
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(s) ? "http://" : "https://") + s;
}

type Wifi = { bssid?: string; ssid?: string; error?: string };

async function readWifi(): Promise<Wifi> {
  try {
    // Android gives the router's MAC ID only to apps with the Location permission, with Location turned on.
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { error: "Allow Location for CMA Office. Android needs it to read the WiFi router. Your place is not saved." };
    if (!(await Location.hasServicesEnabledAsync())) return { error: "Turn on Location on the phone, then try again. Android needs it to read the WiFi router." };
    const state = await NetInfo.refresh();
    if (state.type !== "wifi") return { error: "The phone is not on WiFi. Connect to the office WiFi and try again." };
    const d = state.details as { bssid?: string | null; ssid?: string | null };
    if (!d?.bssid) return { error: "The phone did not give the WiFi router's ID. Turn WiFi off and on, then try again." };
    return { bssid: d.bssid, ssid: d.ssid ?? "" };
  } catch (e) {
    return { error: "Could not read the WiFi: " + String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

/** Bridge version the page checks before asking for a selfie or live location. */
const BRIDGE_V = 2;

async function gpsNow(): Promise<{ lat?: number; lng?: number; acc?: number }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted || !(await Location.hasServicesEnabledAsync())) return {};
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), 15000)),
    ]) ?? (await Location.getLastKnownPositionAsync());
    return p ? { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? undefined } : {};
  } catch {
    return {};
  }
}

type Shot = { photo?: string; lat?: number; lng?: number; acc?: number; error?: string; cancelled?: boolean };

async function takeSelfie(): Promise<Shot> {
  try {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) return { error: "Allow the Camera for CMA Office to take the attendance selfie." };
    const gps = gpsNow(); // at the same time as the photo
    const r = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, mediaTypes: ["images"], quality: 0.8, allowsEditing: false, exif: false });
    if (r.canceled || !r.assets?.[0]) return { cancelled: true };
    const small = await manipulateAsync(r.assets[0].uri, [{ resize: { width: 720 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
    if (!small.base64) return { error: "Could not read the selfie. Try again." };
    return { photo: "data:image/jpeg;base64," + small.base64, ...(await gps) };
  } catch (e) {
    return { error: "Could not take the selfie: " + String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

type TrackMsg = { on?: boolean; token?: string; everyMin?: number; url?: string; why?: string };
type TrackAnswer = { on?: boolean; declined?: boolean; error?: string };

/** Everything except the notice: permissions, then start the foreground service. */
async function startTracking(m: TrackMsg): Promise<TrackAnswer> {
  if (!m.token || !m.url) return { error: "The page did not send what the app needs. Refresh and try again." };
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return { error: "Location is not allowed for CMA Office, so live location is off. Allow it in the phone's Settings → Apps → CMA Office." };
  if (!(await Location.hasServicesEnabledAsync())) return { error: "Location is turned off on the phone, so live location is off. Turn it on and open the app again." };
  // Android 13+: allow the notification, so the person always sees that location is being shared.
  if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as never).catch(() => null);
  }
  try {
    await startSharing({ url: m.url, token: m.token }, m.everyMin ?? 5);
    return { on: true };
  } catch (e) {
    return { error: "Could not start live location: " + String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

export default function App() {
  return <SafeAreaProvider><SafeAreaView style={s.fill} edges={["top", "bottom"]}><Shell /></SafeAreaView></SafeAreaProvider>;
}

function Shell() {
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const web = useRef<WebView<{}>>(null);
  const canBack = useRef(false);
  // The live-location notice: shown once per phone, before sharing starts for the first time.
  const [notice, setNotice] = useState<null | ((yes: boolean) => void)>(null);
  const askNotice = () => new Promise<boolean>((resolve) => setNotice(() => (yes: boolean) => { setNotice(null); resolve(yes); }));

  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((v) => { setUrl(v); setReady(true); }, () => setReady(true));
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canBack.current) { web.current?.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  async function save() {
    const u = cleanUrl(draft);
    if (!u) return;
    await SecureStore.setItemAsync(KEY, u);
    setFailed(null); setUrl(u);
  }
  async function forget() {
    await SecureStore.deleteItemAsync(KEY);
    setDraft(url ?? ""); setFailed(null); setUrl(null);
  }

  const reply = (fn: string, id: string, a: unknown) =>
    web.current?.injectJavaScript(`window.${fn} && window.${fn}(${JSON.stringify(id)}, ${JSON.stringify(a)}); true;`);

  async function onMessage(e: WebViewMessageEvent) {
    let m: { type?: string; id?: string } & TrackMsg;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (typeof m.id !== "string") return;
    // Only the office app's own pages may ask (other sites open outside the app anyway).
    if (url && !String(e.nativeEvent.url ?? "").replace(/^https?:\/\//, "").startsWith(url.replace(/^https?:\/\//, ""))) return;
    if (m.type === "wifi") return reply("__cmaWifi", m.id, await readWifi());
    if (m.type === "ping") return reply("__cmaReply", m.id, { v: BRIDGE_V });
    if (m.type === "selfie") return reply("__cmaReply", m.id, await takeSelfie());
    if (m.type === "track") {
      if (!m.on) { await stopSharing(); return reply("__cmaReply", m.id, { on: false }); }
      if ((await SecureStore.getItemAsync(CONSENT_KEY)) !== "yes") {
        const yes = await askNotice();
        if (!yes) { await stopSharing(); return reply("__cmaReply", m.id, { declined: true } satisfies TrackAnswer); }
        await SecureStore.setItemAsync(CONSENT_KEY, "yes");
      }
      return reply("__cmaReply", m.id, await startTracking(m));
    }
  }

  if (!ready) return <View style={s.center}><ActivityIndicator /></View>;

  if (!url) {
    return (
      <View style={s.setup}>
        <StatusBar barStyle="dark-content" />
        <Text style={s.h1}>CMA Office</Text>
        <Text style={s.p}>Write the office app address once. Your admin gives it to you.</Text>
        <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="for example 187.1.2.3:3000" autoCapitalize="none" autoCorrect={false} keyboardType="url" onSubmitEditing={save} />
        <Pressable style={s.btn} onPress={save}><Text style={s.btnT}>Open</Text></Pressable>
      </View>
    );
  }

  const host = url.replace(/^https?:\/\//, "");
  return (
    <View style={s.fill}>
      <StatusBar barStyle="dark-content" />
      <Modal visible={!!notice} animationType="slide" onRequestClose={() => notice?.(false)}>
        <SafeAreaView style={s.fill} edges={["top", "bottom"]}>
          <ScrollView contentContainerStyle={s.notice}>
            <Text style={s.h1}>Live location while you are checked in</Text>
            <Text style={s.p}>CMA Office collects your phone&apos;s location (GPS) while you are checked in for work, even when the app is closed or not in use, and sends it to your office&apos;s CMA Office server.</Text>
            <Text style={s.li}>• <Text style={s.b}>When:</Text> only between check in and check out. It stops when you check out, or after office time if you forget.</Text>
            <Text style={s.li}>• <Text style={s.b}>You will see it:</Text> a notification stays on the phone the whole time location is shared.</Text>
            <Text style={s.li}>• <Text style={s.b}>Who sees it:</Text> only HR / the CEO in Attendance → Live map, to know where field work is happening. Old history is deleted automatically.</Text>
            <Text style={s.li}>• <Text style={s.b}>You decide:</Text> you can turn it off in Attendance at any time. Your admin will see that it is off.</Text>
            <Text style={[s.p, { marginTop: 8 }]}>অফিসে চেক ইন থাকা অবস্থায় (অ্যাপ বন্ধ থাকলেও) অ্যাপটি আপনার ফোনের লোকেশন অফিস সার্ভারে পাঠাবে। চেক আউট করলে বন্ধ হবে। পুরো সময় ফোনে একটি নোটিফিকেশন থাকবে। শুধু HR / CEO দেখতে পারবেন। আপনি যেকোনো সময় বন্ধ করতে পারবেন।</Text>
            <Pressable style={s.btn} onPress={() => notice?.(true)}><Text style={s.btnT}>I agree, share while checked in</Text></Pressable>
            <Pressable style={s.link} onPress={() => notice?.(false)}><Text style={s.linkT}>Not now</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {failed ? (
        <View style={s.setup}>
          <Text style={s.h1}>Cannot open CMA Office</Text>
          <Text style={s.p}>{failed}</Text>
          <Text style={s.small}>{url}</Text>
          <Pressable style={s.btn} onPress={() => { setFailed(null); setN((x) => x + 1); }}><Text style={s.btnT}>Try again</Text></Pressable>
          <Pressable style={s.link} onPress={forget}><Text style={s.linkT}>Change the address</Text></Pressable>
        </View>
      ) : (
        <WebView<{}>
          key={n}
          ref={web}
          source={{ uri: url }}
          style={s.fill}
          onMessage={onMessage}
          onNavigationStateChange={(st) => { canBack.current = st.canGoBack; }}
          onError={(e) => setFailed(e.nativeEvent.description || "Check the internet connection.")}
          // Links to other sites (Google Sheets, Drive, Facebook) open in the phone's own apps.
          onShouldStartLoadWithRequest={(req) => {
            const same = req.url.replace(/^https?:\/\//, "").startsWith(host);
            if (same || req.url.startsWith("about:")) return true;
            Linking.openURL(req.url).catch(() => {});
            return false;
          }}
          setSupportMultipleWindows={false}
          domStorageEnabled
          javaScriptEnabled
          pullToRefreshEnabled
          startInLoadingState
          renderLoading={() => <View style={[s.center, StyleSheet.absoluteFill]}><ActivityIndicator /></View>}
          mixedContentMode={Platform.OS === "android" ? "compatibility" : undefined}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#f2f5fa" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f2f5fa" },
  setup: { flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#f2f5fa" },
  h1: { fontSize: 24, fontWeight: "600", color: "#1d2b44" },
  p: { fontSize: 15, color: "#52607a", lineHeight: 21 },
  small: { fontSize: 12, color: "#7b879c" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d5deeb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: "#1d2b44" },
  btn: { backgroundColor: "#4a74b0", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnT: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { alignItems: "center", padding: 8 },
  linkT: { color: "#4a74b0", fontSize: 14 },
  notice: { padding: 24, gap: 12, justifyContent: "center", flexGrow: 1 },
  li: { fontSize: 15, color: "#1d2b44", lineHeight: 21 },
  b: { fontWeight: "600" },
});
