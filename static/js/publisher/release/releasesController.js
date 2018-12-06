import React, { Component, Fragment } from "react";
import PropTypes from "prop-types";
import { connect } from "react-redux";
import "whatwg-fetch";

import ReleasesTable from "./releasesTable";
import Notification from "./notification";

import { updateRevisions } from "./actions/revisions";
import { updateReleases } from "./actions/releases";
import {
  initChannelMap,
  selectRevision,
  releaseRevisionSuccess,
  closeChannelSuccess
} from "./actions/channelMap";
import {
  promoteRevision,
  undoRelease,
  cancelPendingReleases
} from "./actions/pendingReleases";
import { hasDevmodeRevisions, getPendingChannelMap } from "./selectors";

import {
  getArchsFromRevisionsMap,
  getTracksFromChannelMap,
  getRevisionsMap,
  initReleasesData,
  getReleaseDataFromChannelMap
} from "./releasesState";

class ReleasesController extends Component {
  constructor(props) {
    super(props);

    // init channel data in revisions list
    // TODO: should be done in reducers?
    const revisionsMap = getRevisionsMap(this.props.releasesData.revisions);
    initReleasesData(revisionsMap, this.props.releasesData.releases);

    // init redux store
    // TODO: should be done outside component as initial state?
    this.props.updateRevisions(revisionsMap);
    this.props.updateReleases(this.props.releasesData.releases);
    this.props.initChannelMap(
      getReleaseDataFromChannelMap(this.props.channelMapsList, revisionsMap)
    );

    const tracks = getTracksFromChannelMap(this.props.channelMapsList);

    this.state = {
      // use "latest" if default track is not defined
      currentTrack: this.props.options.defaultTrack || "latest",
      error: null,
      isLoading: false,
      // list of all available tracks
      tracks: tracks,
      // list of architectures released to (or selected to be released to)
      archs: getArchsFromRevisionsMap(revisionsMap),
      pendingCloses: []
    };
  }

  updateReleasesData(releasesData) {
    // init channel data in revisions list
    const revisionsMap = getRevisionsMap(releasesData.revisions);
    initReleasesData(revisionsMap, releasesData.releases);

    this.props.updateRevisions(revisionsMap);
    this.props.updateReleases(releasesData.releases);
  }

  setCurrentTrack(track) {
    this.setState({ currentTrack: track });
  }

  promoteChannel(channel, targetChannel) {
    const releasedChannels = this.props.pendingChannelMap;
    const archRevisions = releasedChannels[channel];

    if (archRevisions) {
      Object.keys(archRevisions).forEach(arch => {
        this.promoteRevision(archRevisions[arch], targetChannel);
      });
    }
  }

  closeChannel(channel) {
    this.setState(state => {
      let { pendingCloses } = state;

      pendingCloses.push(channel);
      // make sure channels are unique
      pendingCloses = pendingCloses.filter(
        (item, i, ar) => ar.indexOf(item) === i
      );

      // TODO: move to action (when pendingCloses are moved to redux)
      let { pendingReleases } = this.props;

      // undo any pending releases to closed channel
      Object.keys(pendingReleases).forEach(revision => {
        const channels = pendingReleases[revision].channels;

        if (channels.includes(channel)) {
          this.props.undoRelease(pendingReleases[revision].revision, channel);
        }
      });

      return {
        pendingCloses
      };
    });
  }

  // TODO: move to action creator
  promoteRevision(revision, channel) {
    const releasedChannels = this.props.pendingChannelMap;

    // compare given revision with released revisions in this arch and channel
    const isAlreadyReleased = revision.architectures.every(arch => {
      const releasedRevision =
        releasedChannels[channel] && releasedChannels[channel][arch];

      return (
        releasedRevision && releasedRevision.revision === revision.revision
      );
    });

    if (!isAlreadyReleased) {
      this.props.promoteRevision(revision, channel);
    }

    this.setState({
      error: null
    });
  }

  // TODO: remove when pendingCloses are moved to redux
  clearPendingReleases() {
    this.props.cancelPendingReleases();
    this.setState({
      pendingCloses: []
    });
  }

  fetchReleasesHistory() {
    const { csrfToken } = this.props.options;

    return fetch(`/${this.props.snapName}/releases/json`, {
      method: "GET",
      mode: "cors",
      cache: "no-cache",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-CSRFToken": csrfToken
      },
      redirect: "follow",
      referrer: "no-referrer"
    }).then(response => response.json());
  }

  fetchRelease(revision, channels) {
    const { csrfToken } = this.props.options;

    return fetch(`/${this.props.snapName}/releases`, {
      method: "POST",
      mode: "cors",
      cache: "no-cache",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-CSRFToken": csrfToken
      },
      redirect: "follow",
      referrer: "no-referrer",
      body: JSON.stringify({ revision, channels, name: this.props.snapName })
    }).then(response => response.json());
  }

  fetchClose(channels) {
    const { csrfToken } = this.props.options;

    return fetch(`/${this.props.snapName}/releases/close-channel`, {
      method: "POST",
      mode: "cors",
      cache: "no-cache",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-CSRFToken": csrfToken
      },
      redirect: "follow",
      referrer: "no-referrer",
      body: JSON.stringify({ channels })
    }).then(response => response.json());
  }

  // TODO: move inside of this function out
  handleReleaseResponse(json, release) {
    if (json.success) {
      const { revisions } = this.props;

      // update channel map based on the response
      json.channel_map.forEach(map => {
        if (map.revision) {
          let revision;

          if (map.revision === +release.id) {
            // release.id is a string so turn it into a number for comparison
            revision = release.revision;
          } else if (revisions[map.revision]) {
            revision = revisions[map.revision];
          } else {
            revision = {
              revision: map.revision,
              version: map.version,
              architectures: release.revision.architectures
            };
          }

          let channel = map.channel;
          if (channel.indexOf("/") === -1) {
            channel = `latest/${channel}`;
          }

          this.props.releaseRevisionSuccess(revision, channel);
        }
      });
    } else {
      let error = new Error(
        `Error while releasing ${release.revision.version} (${
          release.revision.revision
        }) to ${release.channels.join(", ")}.`
      );
      error.json = json;
      throw error;
    }
  }

  handleReleaseError(error) {
    let message =
      error.message ||
      "Error while performing the release. Please try again later.";

    // try to find error messages in response json
    // which may be an array or errors or object with errors property
    if (error.json) {
      const errors = error.json.length ? error.json : error.json.errors;

      if (errors.length) {
        message =
          message +
          " " +
          errors
            .map(e => e.message)
            .filter(m => m)
            .join(" ");
      }
    }

    this.setState({
      error: message
    });
  }

  handleCloseResponse(json, channels) {
    if (json.success) {
      if (json.closed_channels && json.closed_channels.length > 0) {
        json.closed_channels.forEach(channel => {
          // make sure channels without track name get prefixed with 'latest'
          if (channel.indexOf("/") === -1) {
            channel = `latest/${channel}`;
          }

          this.props.closeChannelSuccess(channel);
        });
      }
    } else {
      let error = new Error(
        `Error while closing channels: ${channels.join(", ")}.`
      );
      error.json = json;
      throw error;
    }
  }

  fetchReleases(releases) {
    var queue = Promise.resolve(); // Q() in q

    // handle releases as a queue
    releases.forEach(release => {
      return (queue = queue.then(() => {
        return this.fetchRelease(release.id, release.channels).then(json =>
          this.handleReleaseResponse(json, release)
        );
      }));
    });
    return queue;
  }

  fetchCloses(channels) {
    if (channels.length) {
      return this.fetchClose(channels).then(json =>
        this.handleCloseResponse(json, channels)
      );
    } else {
      return Promise.resolve();
    }
  }

  fetchUpdatedReleasesHistory() {
    return this.fetchReleasesHistory().then(json =>
      this.updateReleasesData(json)
    );
  }

  releaseRevisions() {
    const { pendingCloses } = this.state;
    const { pendingReleases } = this.props;
    const releases = Object.keys(pendingReleases).map(id => {
      return {
        id,
        revision: pendingReleases[id].revision,
        channels: pendingReleases[id].channels
      };
    });

    this.setState({ isLoading: true });
    this.fetchReleases(releases)
      .then(() => this.fetchCloses(pendingCloses))
      .then(() => this.fetchUpdatedReleasesHistory())
      .catch(error => this.handleReleaseError(error))
      .then(() => this.setState({ isLoading: false }))
      .then(() => this.clearPendingReleases());
  }

  render() {
    return (
      <Fragment>
        <div className="row">
          {this.state.error && (
            <Notification status="error" appearance="negative">
              {this.state.error}
            </Notification>
          )}
          {this.props.hasDevmodeRevisions && (
            <Notification appearance="caution">
              Revisions in development mode cannot be released to stable or
              candidate channels.
              <br />
              You can read more about{" "}
              <a href="https://docs.snapcraft.io/t/snap-confinement/6233">
                <code>devmode</code> confinement
              </a>{" "}
              and{" "}
              <a href="https://docs.snapcraft.io/t/snapcraft-yaml-reference/4276">
                <code>devel</code> grade
              </a>
              .
            </Notification>
          )}
        </div>

        <ReleasesTable
          // map all the state into props
          {...this.state}
          // actions
          setCurrentTrack={this.setCurrentTrack.bind(this)}
          // triggers posting data to API
          releaseRevisions={this.releaseRevisions.bind(this)}
          // TODO: move out to redux (?)
          // depends on state of released revisoins
          promoteRevision={this.promoteRevision.bind(this)}
          // can be moved now (?) - together with getNextReleasedChannels
          promoteChannel={this.promoteChannel.bind(this)}
          // depends on pendingCloses
          clearPendingReleases={this.clearPendingReleases.bind(this)}
          // depends on pendingCloses
          closeChannel={this.closeChannel.bind(this)}
        />
      </Fragment>
    );
  }
}

ReleasesController.propTypes = {
  snapName: PropTypes.string.isRequired,
  channelMapsList: PropTypes.array.isRequired,
  releasesData: PropTypes.object.isRequired,
  options: PropTypes.object.isRequired,

  revisions: PropTypes.object,
  isHistoryOpen: PropTypes.bool,
  revisionsFilters: PropTypes.object,
  releasedChannels: PropTypes.object,
  hasDevmodeRevisions: PropTypes.bool,
  pendingReleases: PropTypes.object,
  pendingChannelMap: PropTypes.object,

  closeChannelSuccess: PropTypes.func,
  releaseRevisionSuccess: PropTypes.func,
  selectRevision: PropTypes.func,
  initChannelMap: PropTypes.func,
  updateReleases: PropTypes.func,
  updateRevisions: PropTypes.func,
  undoRelease: PropTypes.func,
  promoteRevision: PropTypes.func,
  cancelPendingReleases: PropTypes.func
};

const mapStateToProps = state => {
  return {
    isHistoryOpen: state.history.isOpen,
    revisionsFilters: state.history.filters,
    revisions: state.revisions,
    releasedChannels: state.channelMap,
    hasDevmodeRevisions: hasDevmodeRevisions(state),
    pendingReleases: state.pendingReleases,
    pendingChannelMap: getPendingChannelMap(state)
  };
};

const mapDispatchToProps = dispatch => {
  return {
    closeChannelSuccess: channel => dispatch(closeChannelSuccess(channel)),
    releaseRevisionSuccess: (revision, channel) =>
      dispatch(releaseRevisionSuccess(revision, channel)),
    selectRevision: revision => dispatch(selectRevision(revision)),
    initChannelMap: channelMap => dispatch(initChannelMap(channelMap)),
    updateRevisions: revisions => dispatch(updateRevisions(revisions)),
    updateReleases: releases => dispatch(updateReleases(releases)),
    undoRelease: (revision, channel) =>
      dispatch(undoRelease(revision, channel)),
    promoteRevision: (revision, channel) =>
      dispatch(promoteRevision(revision, channel)),
    cancelPendingReleases: () => dispatch(cancelPendingReleases())
  };
};

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(ReleasesController);
