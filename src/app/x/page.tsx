"use client";
import React, { useState, useEffect, useRef } from "react";

interface DID_API_Keys {
  url: string;
  service: string;
  key: string;
  elevenlabs_key: string;
  voice_id: string;
}

const maxRetryCount = 3;
const maxDelaySec = 4;
const stream_warmup = true;

const fetchAPIKeys = async (): Promise<DID_API_Keys> => {
  const response = await fetch("/api/keys/");
  const data = await response.json();
  return data;
};

let stream_id: string | null = null;
let session_id: string | null = null;
let peer_connection: RTCPeerConnection | null = null;
let pc_data_channel: RTCDataChannel | null = null;
let stats_interval_id: any = null;
let last_bytes_received: number | null = null;
let video_is_playing: boolean = false;
let stream_video_opacity: number = 0;
let is_stream_ready: boolean = !stream_warmup;

const presenterInputByService = {
  talks: {
    // default picture
    source_url: "https://i.ibb.co.com/kcBGTLK/photo-2024-07-11-17-06-17.jpg",
  },
  clips: {
    presenter_id: "rian-lZC6MmWfC1",
    driver_id: "mXra4jY38i",
  },
};

const Page = () => {
  const [DID_API, setDID_API] = useState<DID_API_Keys | null>(null);
  const [start_time, setStartTime] = useState(0);
  const [timeIsRunning, setTimeIsRunning] = useState(false);

  // useEffect(() => {
  //   let intervalId: any;
  //   if (timeIsRunning) {
  //     intervalId = setInterval(() => setStartTime(start_time + 1), 10);
  //   }
  //   return () => clearInterval(intervalId);
  // }, [timeIsRunning, start_time]);

  useEffect(() => {
    let intervalId: any;
    if (timeIsRunning) {
      intervalId = setInterval(() => {
        setStartTime((prevTime) => prevTime + 1); // Increment by 1 every second
      }, 1000); // 1000 milliseconds = 1 second
    }
    return () => clearInterval(intervalId);
  }, [timeIsRunning]);

  const seconds = Math.floor((start_time % 6000) / 100);

  const startTime = () => {
    setTimeIsRunning(true);
  };
  const stopTime = () => {
    setTimeIsRunning(false);
  };
  const reset = () => {
    setStartTime(0);
  };

  const [
    sessionClientAnswer,
    setSessionClientAnswer,
  ] = useState<RTCSessionDescriptionInit | null>(null);

  const idleVideoRef = useRef<HTMLVideoElement>(null);
  const streamVideoRef = useRef<HTMLVideoElement>(null);
  const peerStatusLabelRef = useRef<HTMLLabelElement>(null);
  const iceStatusLabelRef = useRef<HTMLLabelElement>(null);
  const iceGatheringStatusLabelRef = useRef<HTMLLabelElement>(null);
  const signalingStatusLabelRef = useRef<HTMLLabelElement>(null);
  const streamingStatusLabelRef = useRef<HTMLLabelElement>(null);
  const streamEventLabelRef = useRef<HTMLLabelElement>(null);
  const sendInputRef = useRef<HTMLInputElement>(null);
  const readButtonRef = useRef<HTMLButtonElement>(null);
  const sendAudioButtonRef = useRef<HTMLButtonElement>(null);
  const sendAudioInputRef = useRef<HTMLInputElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const destroyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const loadAPIKeys = async () => {
      const apiKeys = await fetchAPIKeys();
      setDID_API(apiKeys);
    };
    loadAPIKeys();
  }, []);

  const fetchWithRetries = async (
    url: string,
    options: RequestInit,
    retries = 1
  ): Promise<Response> => {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (retries <= maxRetryCount) {
        const delay =
          Math.min(Math.pow(2, retries) / 4 + Math.random(), maxDelaySec) *
          1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        console.log(
          `Request failed, retrying ${retries}/${maxRetryCount}. Error ${err}`
        );
        return fetchWithRetries(url, options, retries + 1);
      } else {
        throw new Error(`Max retries exceeded. error: ${err}`);
      }
    }
  };

  const onReadInput = async () => {
    if (!DID_API) return;

    const textToSpeak = sendInputRef.current?.value;
    if (
      (peer_connection?.signalingState === "stable" ||
        peer_connection?.iceConnectionState === "connected") &&
      is_stream_ready
    ) {
      startTime();
      const playResponse = await fetchWithRetries(
        `${DID_API.url}/${DID_API.service}/streams/${stream_id}`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${DID_API.key}`,
            "Content-Type": "application/json",
            "x-api-key-external": `{"elevenlabs": "${DID_API.elevenlabs_key}"}`,
          },
          body: JSON.stringify({
            script: {
              type: "text",
              provider: {
                type: "elevenlabs",
                voice_id: DID_API.voice_id,
              },
              ssml: "false",
              input: textToSpeak,
            },
            config: {
              fluent: "false",
              pad_audio: "0.0",
            },
            audio_optimization: "2",
            session_id: session_id,
          }),
        }
      );

      if (playResponse.ok) {
        if (readButtonRef.current)
          readButtonRef.current.textContent = "Streaming...";
      } else {
        if (readButtonRef.current)
          readButtonRef.current.textContent = "Failed to Start Stream";
        stopTime();
        reset();
      }
    } else {
      if (readButtonRef.current)
        readButtonRef.current.textContent = "Unable to Connect";
      stopTime();
    }
  };

  const onConnect = async () => {
    if (!DID_API) return;

    if (peer_connection && peer_connection.connectionState === "connected") {
      return;
    }

    stopAllStreams();
    closePC();

    const sessionResponse = await fetchWithRetries(
      `${DID_API.url}/${DID_API.service}/streams`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${DID_API.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...presenterInputByService["talks"],
          stream_warmup,
        }),
      }
    );

    const {
      id: newStreamId,
      offer,
      ice_servers: iceServers,
      session_id: newSessionId,
    } = await sessionResponse.json();

    stream_id = newStreamId;
    session_id = newSessionId;

    try {
      console.log(sessionResponse);
      const answer = await createPeerConnection(offer, iceServers);
      setSessionClientAnswer(answer);

      await fetch(
        `${DID_API.url}/${DID_API.service}/streams/${newStreamId}/sdp`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${DID_API.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            answer: answer,
            session_id: newSessionId,
          }),
        }
      );
    } catch (e) {
      console.log("error during streaming setup", e);
      stopAllStreams();
      closePC();
      return;
    }
  };

  const onDestroy = async () => {
    if (!DID_API) return;

    await fetch(`${DID_API.url}/${DID_API.service}/streams/${stream_id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${DID_API.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session_id: session_id }),
    });

    stopAllStreams();
    reset();
    closePC();
  };

  const onIceGatheringStateChange = () => {
    if (!peer_connection) return;

    if (iceGatheringStatusLabelRef.current) {
      iceGatheringStatusLabelRef.current.innerText = peer_connection!.iceGatheringState;
      iceGatheringStatusLabelRef.current.className =
        "iceGatheringState-" + peer_connection!.iceGatheringState;
    }
  };

  const onIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    console.log("onIceCandidate", event);
    if (!DID_API) return;

    if (event.candidate) {
      const { candidate, sdpMid, sdpMLineIndex } = event.candidate;

      fetch(`${DID_API.url}/${DID_API.service}/streams/${stream_id}/ice`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${DID_API.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          candidate,
          sdpMid,
          sdpMLineIndex,
          session_id: session_id,
        }),
      });
    } else {
      fetch(`${DID_API.url}/${DID_API.service}/streams/${stream_id}/ice`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${DID_API.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session_id,
        }),
      });
    }
  };

  const onIceConnectionStateChange = () => {
    console.log("onIceConnectionStateChange");
    if (!peer_connection) return;

    console.log(
      "onIceConnectionStateChange actually runnig",
      peer_connection!.iceConnectionState
    );

    if (iceStatusLabelRef.current) {
      iceStatusLabelRef.current.innerText = peer_connection!.iceConnectionState;
      iceStatusLabelRef.current.className =
        "iceConnectionState-" + peer_connection!.iceConnectionState;
    }
    if (
      peer_connection!.iceConnectionState === "failed" ||
      peer_connection!.iceConnectionState === "closed"
    ) {
      stopAllStreams();
      closePC();
    }
  };

  const onConnectionStateChange = () => {
    if (peerStatusLabelRef.current) {
      peerStatusLabelRef.current.innerText = peer_connection!.connectionState;
      peerStatusLabelRef.current.className =
        "peerConnectionState-" + peer_connection!.connectionState;
    }
    if (peer_connection!.connectionState === "connected") {
      playIdleVideo();
      setTimeout(() => {
        if (!is_stream_ready) {
          console.log("forcing stream/ready");
          is_stream_ready = true;
          if (streamEventLabelRef.current) {
            streamEventLabelRef.current.innerText = "ready";
            streamEventLabelRef.current.className = "streamEvent-ready";
          }
        }
      }, 5000);
    }
  };

  const onSignalingStateChange = () => {
    if (!peer_connection) return;
    if (signalingStatusLabelRef.current) {
      signalingStatusLabelRef.current.innerText = peer_connection!.signalingState;
      signalingStatusLabelRef.current.className =
        "signalingState-" + peer_connection!.signalingState;
    }
  };

  const onVideoStatusChange = (
    videoIsPlaying: boolean,
    stream: MediaStream
  ) => {
    let status;

    console.log("onVideoStatusChange: video status changed", videoIsPlaying);

    if (videoIsPlaying) {
      status = "streaming";
      stream_video_opacity = is_stream_ready ? 1 : 0;
      setStreamVideoElement(stream);
    } else {
      status = "empty";
      stream_video_opacity = 0;
    }

    if (streamVideoRef.current) {
      streamVideoRef.current.style.opacity = stream_video_opacity.toString();
    }
    if (idleVideoRef.current) {
      idleVideoRef.current.style.opacity = (
        1 - stream_video_opacity
      ).toString();
    }

    if (streamingStatusLabelRef.current) {
      streamingStatusLabelRef.current.innerText = status;
      streamingStatusLabelRef.current.className = "streamingState-" + status;
    }
  };

  const onTrack = (event: RTCTrackEvent) => {
    if (!event.track) return;

    stats_interval_id = setInterval(async () => {
      const stats = await peer_connection!.getStats(event.track);
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") {
          const videoStatusChanged =
            video_is_playing !== report.bytesReceived > last_bytes_received!;
          if (videoStatusChanged) {
            video_is_playing = report.bytesReceived > last_bytes_received!;
            onVideoStatusChange(
              report.bytesReceived > last_bytes_received!,
              event.streams[0]
            );
          }
          last_bytes_received = report.bytesReceived;
        }
      });
    }, 500);
  };

  const onStreamEvent = (message: MessageEvent) => {
    if (pc_data_channel?.readyState === "open") {
      let status;
      const [event, _] = message.data.split(":");

      switch (event) {
        case "stream/started":
          status = "started";
          stopTime();
          break;
        case "stream/done":
          status = "done";
          stopTime();
          reset();
          break;
        case "stream/ready":
          status = "ready";
          break;
        case "stream/error":
          status = "error";
          break;
        default:
          status = "dont-care";
          break;
      }

      if (status === "ready") {
        setTimeout(() => {
          console.log("stream/ready");
          is_stream_ready = true;
          if (streamEventLabelRef.current) {
            streamEventLabelRef.current.innerText = "ready";
            streamEventLabelRef.current.className = "streamEvent-ready";
          }
        }, 1000);
      } else {
        console.log(event);
        if (streamEventLabelRef.current) {
          streamEventLabelRef.current.innerText =
            status === "dont-care" ? event : status;
          streamEventLabelRef.current.className = "streamEvent-" + status;
        }
      }
    }
  };

  const createPeerConnection = async (
    offer: RTCSessionDescriptionInit,
    iceServers: RTCIceServer[]
  ) => {
    if (!peer_connection) {
      const newPeerConnection = new RTCPeerConnection({ iceServers });
      const newPcDataChannel = newPeerConnection.createDataChannel(
        "JanusDataChannel"
      );
      newPeerConnection.addEventListener(
        "icegatheringstatechange",
        onIceGatheringStateChange,
        true
      );
      newPeerConnection.addEventListener("icecandidate", onIceCandidate, true);
      newPeerConnection.addEventListener(
        "iceconnectionstatechange",
        onIceConnectionStateChange,
        true
      );
      newPeerConnection.addEventListener(
        "connectionstatechange",
        onConnectionStateChange,
        true
      );
      newPeerConnection.addEventListener(
        "signalingstatechange",
        onSignalingStateChange,
        true
      );
      newPeerConnection.addEventListener("track", onTrack, true);
      newPcDataChannel.addEventListener("message", onStreamEvent, true);

      console.log("setting is called");
      console.log(newPeerConnection);

      await newPeerConnection.setRemoteDescription(offer);

      console.log("created peer connection");

      const sessionClientAnswer = await newPeerConnection!.createAnswer();
      console.log("create local sdp OK");

      await newPeerConnection!.setLocalDescription(sessionClientAnswer);
      console.log("set local sdp OK");

      peer_connection = newPeerConnection;
      pc_data_channel = newPcDataChannel;

      return sessionClientAnswer;
    }

    console.log("working witht the created peer connection", peer_connection);

    await peer_connection!.setRemoteDescription(offer);
    console.log("set remote sdp OK");

    const sessionClientAnswer = await peer_connection!.createAnswer();
    console.log("create local sdp OK");

    await peer_connection!.setLocalDescription(sessionClientAnswer);
    console.log("set local sdp OK");

    return sessionClientAnswer;
  };

  const setStreamVideoElement = (stream: MediaStream) => {
    if (!stream || !streamVideoRef.current) return;

    streamVideoRef.current.srcObject = stream;
    streamVideoRef.current.loop = false;
    streamVideoRef.current.muted = !is_stream_ready;

    if (streamVideoRef.current.paused) {
      streamVideoRef.current.play().catch((e) => {});
    }
  };

  const playIdleVideo = () => {
    if (!idleVideoRef.current) return;
    idleVideoRef.current.src =
      DID_API?.service === "clips" ? "rian_idle.mp4" : "or_idle.mp4";
  };

  const stopAllStreams = () => {
    if (!streamVideoRef.current) return;

    if (streamVideoRef.current.srcObject) {
      console.log("stopping video streams");
      const tracks = (streamVideoRef.current
        .srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
      streamVideoRef.current.srcObject = null;
      stream_video_opacity = 0;
    }
  };

  const closePC = (pc: RTCPeerConnection | null = peer_connection) => {
    console.log("stopped peern connection");
    // if (!pc) return;
    // console.log("stopping peer connection");
    // pc.close();
    // pc.removeEventListener(
    //   "icegatheringstatechange",
    //   onIceGatheringStateChange,
    //   true
    // );
    // pc.removeEventListener("icecandidate", onIceCandidate, true);
    // pc.removeEventListener(
    //   "iceconnectionstatechange",
    //   onIceConnectionStateChange,
    //   true
    // );
    // pc.removeEventListener(
    //   "connectionstatechange",
    //   onConnectionStateChange,
    //   true
    // );
    // pc.removeEventListener(
    //   "signalingstatechange",
    //   onSignalingStateChange,
    //   true
    // );
    // // pc.removeEventListener("track", onTrack, true);
    // // pc.removeEventListener("message", onStreamEvent, true);

    // if (statsIntervalId !== null) {
    //   clearInterval(statsIntervalId);
    // }
    // setIsStreamReady(!stream_warmup);
    // setStreamVideoOpacity(0);

    // if (iceGatheringStatusLabelRef.current)
    //   iceGatheringStatusLabelRef.current.innerText = "";
    // if (signalingStatusLabelRef.current)
    //   signalingStatusLabelRef.current.innerText = "";
    // if (iceStatusLabelRef.current) iceStatusLabelRef.current.innerText = "";
    // if (peerStatusLabelRef.current) peerStatusLabelRef.current.innerText = "";
    // if (streamEventLabelRef.current) streamEventLabelRef.current.innerText = "";

    // console.log("stopped peer connection");
    // if (pc === peerConnection) {
    //   setPeerConnection(null);
    // }
  };

  return (
    <div id="content">
      <div id="video-wrapper">
        <div>
          <video
            ref={idleVideoRef}
            id="idle-video-element"
            width="400"
            height="400"
            autoPlay
            loop
            style={{ opacity: 1 }}
          ></video>
          <video
            ref={streamVideoRef}
            id="stream-video-element"
            width="400"
            height="400"
            autoPlay
            style={{ opacity: 0 }}
          ></video>
        </div>
      </div>
      <br />

      <div className="textfield">
        <input type="text" ref={sendInputRef} id="input-send" />
        <button
          type="button"
          ref={readButtonRef}
          id="read-button"
          onClick={onReadInput}
        >
          Read
        </button>
      </div>

      {/* <div className="add-auto-file">
        <input type="file" ref={sendAudioInputRef} id="file" />
        <button
          type="button"
          ref={sendAudioButtonRef}
          id="send-button-audio"
          onClick={onReadInput2}
        >
          Send
        </button>
      </div> */}

      <div id="buttons">
        <button
          ref={connectButtonRef}
          id="connect-button"
          type="button"
          onClick={onConnect}
        >
          Connect
        </button>
        <button
          ref={destroyButtonRef}
          id="destroy-button"
          type="button"
          onClick={onDestroy}
        >
          Destroy
        </button>
      </div>

      <div id="status">
        ICE gathering status:{" "}
        <label
          ref={iceGatheringStatusLabelRef}
          id="ice-gathering-status-label"
        ></label>
        <br />
        ICE status:{" "}
        <label ref={iceStatusLabelRef} id="ice-status-label"></label>
        <br />
        Peer connection status:{" "}
        <label ref={peerStatusLabelRef} id="peer-status-label"></label>
        <br />
        Signaling status:{" "}
        <label
          ref={signalingStatusLabelRef}
          id="signaling-status-label"
        ></label>
        <br />
        Last stream event:{" "}
        <label ref={streamEventLabelRef} id="stream-event-label"></label>
        <br />
        Streaming status:{" "}
        <label
          ref={streamingStatusLabelRef}
          id="streaming-status-label"
        ></label>
        <br />
        <label>Time: {start_time}</label>
      </div>

      <div id="react-root"></div>
    </div>
  );
};

export default Page;
