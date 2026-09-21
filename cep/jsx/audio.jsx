/* Audio-specific functions */

function _clipVolumeLevel(clip) {
  for (var i = 0; i < clip.components.numItems; i++) {
    var comp = clip.components[i];
    if (/^Internal Volume/.test(comp.matchName) || comp.displayName.toLowerCase() === "volume") {
      for (var j = 0; j < comp.properties.numItems; j++) {
        var prop = comp.properties[j];
        if (prop.displayName.toLowerCase() === "level" || prop.displayName === "级别") return prop;
      }
    }
  }
  return null;
}

function setClipVolume(trackIndex, clipIndex, volumeDb) {
  var e = _requireSequence();
  if (e) return e;
  var clip = _getClip("audio", trackIndex, clipIndex);
  if (!clip) return _err("Clip not found");

  var level = _clipVolumeLevel(clip);
  if (level) {
    if (!isFinite(volumeDb) || volumeDb < -96 || volumeDb > 15) return _err("Volume must be between -96 and +15 dB");
    // Premiere's normalized level has 0 dB at 10^(-15/20), not at 1.
    level.setValue(volumeDb <= -96 ? 0 : Math.pow(10, (volumeDb - 15) / 20), true);
    var raw = level.getValue();
    return _ok({ volumeDb: raw > 0 ? 20 * Math.log(raw) / Math.LN10 + 15 : -96 });
  }
  return _err("Volume component not found");
}

function getClipVolume(trackIndex, clipIndex) {
  var e = _requireSequence();
  if (e) return e;
  var clip = _getClip("audio", trackIndex, clipIndex);
  if (!clip) return _err("Clip not found");

  var level = _clipVolumeLevel(clip);
  if (level) {
    var raw = level.getValue();
    return JSON.stringify({ volumeDb: raw > 0 ? 20 * Math.log(raw) / Math.LN10 + 15 : -96 });
  }
  return _err("Volume component not found");
}

function setClipMute(trackIndex, clipIndex, muted) {
  var e = _requireSequence();
  if (e) return e;
  var clip = _getClip("audio", trackIndex, clipIndex);
  if (!clip) return _err("Clip not found");
  clip.setDisabled(muted);
  return _ok({ muted: muted });
}

function setAudioChannelMapping(nodeId, channelType) {
  var e = _requireProject();
  if (e) return e;
  var item = _findProjectItemByNodeId(app.project.rootItem, nodeId);
  if (!item) return _err("Item not found: " + nodeId);

  var interp = item.getFootageInterpretation();
  if (!interp) return _err("Cannot get footage interpretation");

  if (channelType === "mono") interp.audioChannelType = 0;
  else if (channelType === "stereo") interp.audioChannelType = 1;
  else if (channelType === "5.1") interp.audioChannelType = 2;
  else if (channelType === "adaptive") interp.audioChannelType = 3;

  item.setFootageInterpretation(interp);
  return _ok({ channelType: channelType });
}

function getAudioChannelMapping(nodeId) {
  var e = _requireProject();
  if (e) return e;
  var item = _findProjectItemByNodeId(app.project.rootItem, nodeId);
  if (!item) return _err("Item not found: " + nodeId);

  var interp = item.getFootageInterpretation();
  if (!interp) return _err("Cannot get footage interpretation");

  var typeMap = { 0: "mono", 1: "stereo", 2: "5.1", 3: "adaptive" };
  return JSON.stringify({
    audioChannelType: typeMap[interp.audioChannelType] || "unknown",
    audioChannelTypeRaw: interp.audioChannelType,
  });
}

function setTrackVolume(trackIndex, volumeDb) {
  var e = _requireSequence();
  if (e) return e;
  // Track volume is set through QE or track mixer - limited API support
  return _ok({ note: "Track volume requires Audio Track Mixer. Use setClipVolume for individual clips." });
}

function setTrackPan(trackIndex, pan) {
  var e = _requireSequence();
  if (e) return e;
  return _ok({ note: "Track pan requires Audio Track Mixer UI." });
}

function soloTrack(trackIndex, solo) {
  var e = _requireSequence();
  if (e) return e;
  // Solo is not directly exposed in ExtendScript DOM
  return _ok({ note: "Solo track via ExtendScript not directly supported. Use execute_extendscript with QE." });
}

function addAudioKeyframe(trackIndex, clipIndex, timeSec, volumeDb) {
  var e = _requireSequence();
  if (e) return e;
  var clip = _getClip("audio", trackIndex, clipIndex);
  if (!clip) return _err("Clip not found");

  for (var i = 0; i < clip.components.numItems; i++) {
    var comp = clip.components[i];
    if (comp.displayName.toLowerCase() === "volume") {
      for (var j = 0; j < comp.properties.numItems; j++) {
        if (comp.properties[j].displayName.toLowerCase() === "level") {
          var prop = comp.properties[j];
          if (!prop.isTimeVarying()) prop.setTimeVarying(true);
          var t = _makeTime(timeSec);
          prop.addKey(t.ticks);
          prop.setValueAtKey(t.ticks, volumeDb, true);
          return _ok({ time: timeSec, volumeDb: volumeDb });
        }
      }
    }
  }
  return _err("Volume component not found");
}

function applyAudioCrossfade(trackIndex, clipIndex, type, durationSec) {
  var e = _requireSequence();
  if (e) return e;

  app.enableQE();
  var qeSeq = qe.project.getActiveSequence();
  var qeTrack = qeSeq.getAudioTrackAt(trackIndex);
  var qeClip = qeTrack.getItemAt(clipIndex);
  if (!qeClip) return _err("QE clip not found");

  var nameMap = {
    "constant_gain": "Constant Gain",
    "constant_power": "Constant Power",
    "exponential_fade": "Exponential Fade",
  };
  var transitionName = nameMap[type] || "Constant Power";

  var transitions = qe.project.getAudioTransitionList();
  for (var i = 0; i < transitions.numItems; i++) {
    if (transitions[i].name === transitionName) {
      qeClip.addTransition(transitions[i], true);
      return _ok({ transition: transitionName });
    }
  }
  return _err("Audio transition not found: " + transitionName);
}
