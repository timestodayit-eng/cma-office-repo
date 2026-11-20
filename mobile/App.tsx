// CMA Office for Android: the same app as the website, inside a native shell.
// The one thing the shell adds is reading which WiFi router the phone is on (its MAC ID),
// which a website cannot do. The attendance page asks for it before check in / check out.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
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

  async function onMessage(e: WebViewMessageEvent) {
    let m: { type?: string; id?: string };
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type !== "wifi" || typeof m.id !== "string") return;
    const wifi = await readWifi();
    web.current?.injectJavaScript(`window.__cmaWifi && window.__cmaWifi(${JSON.stringify(m.id)}, ${JSON.stringify(wifi)}); true;`);
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
});
