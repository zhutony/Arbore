// @flow
import { createAction } from 'redux-actions'
import Share, { ShareState, writable } from 'models/Share'
import ShareRecipient from 'models/ShareRecipient'
import Contact from 'models/Contact'
import IpfsDirectory from 'models/IpfsDirectory'
import { IpfsConnector } from '@akashaproject/ipfs-connector'
import { waitForIpfsReady } from 'ipfs/index'
import path from 'path'
import * as shareList from 'actions/shareList'
import * as ipfsObject from 'actions/ipfsObject'
import bs58 from 'bs58'

export const addEmptyObject = createAction('SHARE_EMPTY_OBJECT_ADD',
  (id: number, name: string, hash: string) => ({id, name, hash})
)
export const toggleFavorite = createAction('SHARE_FAVORITE_TOGGLE',
  (id: number) => ({id})
)
export const setRecipientNotified = createAction('SHARE_RECIPIENT_NOTIFIED',
  (id: number, pubkey: string) => ({id, pubkey})
)

export const priv = {
  setHash: createAction('SHARE_HASH_SET',
    (id: number, hash: string) => ({id, hash})
  )
}

// Trigger the download of content by pinning the root hashes
// Update the state accordingly
export function triggerDownload(share: Share) {
  return async function (dispatch) {
    console.log('Trigger download of ' + share.title)

    dispatch(setStarted(share.id))

    const instance = IpfsConnector.getInstance()

    await waitForIpfsReady()

    try {
      await Promise.all(
        share.content.map((x: IpfsObject) =>
          instance.api.apiClient.pin.add(x.hash)
        )
      )
      console.log('all pin added')
    } catch (error) {
      console.error(error)
    }
  }
}

// Add the content to IPFS, create and store a new Share
export function createShare(title: string, description: string, recipients: Array<Contact>, content: Array) {
  return async function* (dispatch) {
    const instance = IpfsConnector.getInstance()
    await waitForIpfsReady()

    let share: Share = Share.create(null, title, description)

    let addedSize = 0
    let totalSize = 0
    for (let element of content) {
      totalSize += await element.size
    }

    // Prepare an empty wrapper directory in IPFS
    let result = await instance.api.apiClient.object.new('unixfs-dir')
    let wrapper = result.multihash

    // Add the content to the local IPFS repo
    for(const {path: contentPath, size} of content) {

      // Feedback with the progress
      yield {
        progress: addedSize / totalSize,
        nextProgress: (addedSize + await size) / totalSize,
        adding: path.basename(contentPath)
      }

      result = await instance.api.apiClient.util.addFromFs(contentPath, {
        recursive: true,
        hidden: true,
        ignore: [
          'Thumbs.db',
          '.DS_Store',
          '.Trashes',
          '.fseventsd',
          '.Spotlight-V100',
          '$Recycle.Bin',
          // 'System Volume Information' // TODO: this one doesn't work
        ]
      })

      addedSize += await size

      // The daemon stream a result object for each element added. We care only for the last (the root element).
      const hash = result[result.length - 1].hash

      // patch the wrapper directory to add a new child
      result = await instance.api.apiClient.object.patch.addLink(wrapper, {
        name: path.basename(contentPath),
        multihash: new Buffer(bs58.decode(hash))
      })
      wrapper = result.multihash
    }

    // store the content
    share = share.set(writable.content, IpfsDirectory.create(bs58.encode(wrapper)))

    // store the recipients
    recipients.forEach((recipient: Contact) => {
      share = share.set(writable.recipients,
        share.recipients.set(recipient.pubkey, ShareRecipient.create(recipient.pubkey))
      )
    })

    // Set the status
    share = share.set(writable.status, ShareState.SHARING)

    // Store the share in the shareList
    share = await dispatch(shareList.storeShare(share))

    // Publish the share
    share = await dispatch(publishShare(share))

    // Notify each recipients if possible
    share.recipients.forEach((recipient: ShareRecipient) => {
      dispatch(shareList.sendShare(share, recipient.pubkey))
    })

    // Fetch content metadata
    dispatch(ipfsObject.fetchDirectoryMetadata(share.content.hash))
  }
}

/**
 * Publish the share description data in IPFS
 * @param share
 */
export function publishShare(share: Share) {
  return async function (dispatch, getState) {
    console.log('Publish share ' + share.title)
    const ipfs: IpfsConnector = IpfsConnector.getInstance()

    await waitForIpfsReady()

    const profile = getState().profile
    const data = share.getPublishObject(profile)

    const {hash} = await ipfs.api.createNode(data, [])
    console.log('share hash: ' + hash)
    await dispatch(priv.setHash(share.id, hash))

    return getState().shareList.findById(share.id)
  }
}

/**
 * Fetch and decode a Share description
 * @param hash
 */
export function fetchShareDescription(hash: string) {
  return async function (dispatch) {
    console.log('fetch share description: ' + hash)
    const ipfs = IpfsConnector.getInstance()

    await waitForIpfsReady()

    const data = await ipfs.api.getObject(hash)
    console.log(data)

    return Share.fromData(hash, data)
  }
}

/**
 * Export a Share to disk
 * @param share
 * @param basepath the directory to put the data to
 */
export function exportShare(share: Share, basepath: string) {
  return async function*(dispatch) {
    if(!share.content) {
      throw 'No content to export'
    }

    for(const [name, object] of share.content.children.entrySeq()) {

      // Feedback
      yield {
        export: name
      }

      await dispatch(ipfsObject.exportObject(object.hash, name, basepath))
    }
  }
}
