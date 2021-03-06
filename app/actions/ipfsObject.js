// @flow
import { createAction } from 'redux-actions'
import { IpfsConnector } from '@akashaproject/ipfs-connector'
import { waitForIpfsReady } from 'ipfs/index'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { IpfsObject, ObjectType } from 'models/IpfsObject'

/*
 * This is what we use for now:
 *
 * Directory metadata: ipfs ls
 *  -> shortcoming, right now this doesn't tell the object type (dir/file) so we need
 *     to know beforehand. We use the higher level ipfs ls call to know the type down
 *     the graph but it doesn't work for the root as we don't have a higher level dir.
 *
 * Trigger a download: ipfs pin
 *  -> not sure if it's the best idea
 *
 * Track the progress:
 *  -> TODO
 */

export const priv = {
  receivedDirMetadata: createAction('DIR_METADATA_RECEIVED',
    (hash: string, links: [], isLocal: boolean) => ({hash, links, isLocal})
  ),
  isLocal: createAction('IPFS_OBJECT_LOCAL',
    (hash: string, isLocal: boolean, sizeLocal: number = 0, sizeTotal: number = 0) => ({hash, isLocal, sizeLocal, sizeTotal})
  )
}

// Request metadata from ipfs for an unknow object
export function fetchDirectoryMetadata(hash: string, islocal: boolean = false) {
  return async function (dispatch) {
    console.log('FETCH DIRECTORY METADATA OF ' + hash)

    const instance = IpfsConnector.getInstance()

    await waitForIpfsReady()

    const links = await instance.api.apiClient.ls(hash)

    // Store what we have
    dispatch(priv.receivedDirMetadata(hash, links, islocal))

    // Request metadatas for each child directory
    await Promise.all(
      links
        .filter(({type}) => type === 'dir')
        .map(({hash}) => dispatch(fetchDirectoryMetadata(hash)))
    )
  }
}

/**
 * Export an ipfs object on disk
 * @param hash the hash of the object
 * @param name the name of the object
 * @param basepath the directory where to put the data
 */
export function exportObject(hash: string, name: string, basepath: string) {
  return async function (dispatch) {
    console.log(`Exporting ${name} to ${basepath}`)

    const instance = IpfsConnector.getInstance()

    await waitForIpfsReady()

    const results = await instance.api.apiClient.get(hash)
    const result = results[0]

    return new Promise((resolve, reject) => {
      const finalDest = join(basepath, name)

      // Pipe the file content into an actual write stream
      const writeStream = createWriteStream(finalDest, {
        flags: 'wx', // write, fail if exist
      })

      writeStream.on('error', reject)

      writeStream.write(result.content)
      writeStream.end()
      resolve()
    })
  }
}

/**
 * Inspect a graph of IPFS object to update what is local or not
 * @param obj
 */
export function isLocalRecursive(obj: IpfsObject) {
  return async function(dispatch) {
    console.log(`IsLocalRecursive: ${obj.hash}`)

    const local = await dispatch(isLocal(obj.hash))

    if(local) {
      // Nothing more to do, everything under (if any) is local as well
      return true
    }

    if(obj.type === ObjectType.DIRECTORY) {
      // Request locality for each child directory
      await Promise.all(
        obj.children.map((child: IpfsObject) => dispatch(isLocalRecursive(child)))
      )
    }

    return false
  }
}

/**
 * Check if an object is fully local
 * @param hash
 */
export function isLocal(hash: string) {
  return async function(dispatch) {
    console.log(`IsLocal: ${hash}`)

    const instance = IpfsConnector.getInstance()

    await waitForIpfsReady()

    let stats
    try {
      stats = await instance.api.apiClient.files.stat('/ipfs/' + hash, {'withLocal': true})
    } catch(err) {
      console.error(err)
      dispatch(priv.isLocal(hash, false))
      return false
    }

    const {withLocality, local, sizeLocal, cumulativeSize} = stats
    const isLocal = withLocality && (local === true)

    console.log(`${hash} is ${isLocal ? 'local' : 'not local'}, ${sizeLocal}/${cumulativeSize} - ${100*sizeLocal/cumulativeSize}%`)

    if(sizeLocal === undefined) {
      throw 'local size is not present'
    }

    // Update redux
    dispatch(priv.isLocal(hash, isLocal, sizeLocal, cumulativeSize))

    return isLocal
  }
}

/**
 * Trigger a download. Resolve when the download is done or when an error occured.
 * @param hash
 * @returns {Function}
 */
export function triggerDownload(hash: string) {
  return async function() {

    console.log(`triggerDownload: ${hash}`)

    const instance = IpfsConnector.getInstance()

    await waitForIpfsReady()

    return instance.api.apiClient.pin.add(hash)
  }
}
