// @flow
import React, { Component } from 'react'
import { withStyles, createStyleSheet } from 'material-ui/styles'
import Share from 'models/Share'
import { ObjectType } from 'models/IpfsObject'
import type { IpfsObject } from 'models/IpfsObject'
import IpfsFile from 'models/IpfsFile'
import IpfsDirectory from 'models/IpfsDirectory'
import FontAwesome from 'react-fontawesome'
import * as humanize from 'utils/humanize'

class ShareFiles extends Component {

  props: {
    share: Share
  }

  // This is not the more elegant code ever
  // but apparently this is the way to concatenate
  // jsx elements
  buffer: Array

  renderObject(obj: IpfsObject, name: string, path: string, level: number) {
    switch(obj.type) {
      case ObjectType.DIRECTORY:
        this.renderDirectory(obj, name, path, level)
        break
      case ObjectType.FILE:
        this.renderFile(obj, name, path, level)
        break
      default:
        console.assert(false)
    }
  }

  renderFile(file: IpfsFile, name: string, path: string, level: number) {
    const { classes } = this.props
    const progress: number = file.sizeLocal / file.sizeTotal * 100
    this.buffer.push(
      <div key={path} className={classes.object}>
        <span style={{width: `${20*level}px`, display: 'inline-block'}} />
        <span className={classes.icon}><FontAwesome name="file-o"/></span>
        <span className={classes.name}>{ name }</span>
        <div className={classes.progress}>
          <div style={{width: `${progress}%`, backgroundColor: 'green'}} >{progress}%</div>
        </div>
        <span className={classes.size}>{humanize.filesize(file.sizeTotal)}</span>
      </div>
    )
  }

  renderDirectory(dir: IpfsDirectory, name: string, path: string, level: number) {
    const { classes } = this.props
    this.buffer.push(
      <div key={path} className={classes.object}>
        <span style={{width: `${20*level}px`, display: 'inline-block'}} />
        <span className={classes.expander}><FontAwesome name="folder-open-o"/></span>
        <span className={classes.name}>{ name }</span>
      </div>
    )

    dir.children.entrySeq().forEach(
      ([name, object]) => this.renderObject(object, name, path + '/' + name, level + 1)
    )
  }

  render() {
    if(! this.props.share.metadataLocal) {
      return (<div>Waiting for metadata...</div>)
    }

    const { classes, share } = this.props
    const content = share.content.children
    this.buffer = []

    content.entrySeq().forEach(([name, object]) =>
      this.renderObject(object, name, name, 0)
    )

    return (
      <div className={classes.wrapper}>
        { this.buffer }
      </div>
    );
  }
}

const styleSheet = createStyleSheet('ShareFiles', theme => ({
  wrapper: {
    backgroundColor: theme.palette.background.appBar,
    borderRadius: 5,
  },
  object: {
    height: 20,
    display: 'flex',
    flexDirection: 'row',
  },
  expander: {
    width: 20,
    textAlign: 'center',
    display: 'inline-block',
    cursor: 'pointer',
  },
  icon: {
    width: 20,
    textAlign: 'center',
    display: 'inline-block',
  },
  name: {
    flexGrow: 1,
  },
  progress: {
    width: 60,
    border: '1px solid gray',
  },
  size: {
    width: 100,
    textAlign: 'center',
  },
}))

export default withStyles(styleSheet)(ShareFiles)
