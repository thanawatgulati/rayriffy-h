const _ = require('lodash')
const axios = require('axios')
const Promise = require('bluebird')
const fs = require('fs')
const path = require('path')
const {createFilePath} = require('gatsby-source-filesystem')
const {TaskQueue} = require('cwait')

const MAX_SIMULTANEOUS_DOWNLOADS = 3

exports.createPages = ({graphql, actions}) => {
  const {createPage} = actions

  return new Promise((resolve, reject) => {
    resolve(
      graphql(
        `
          {
            allDataJson {
              edges {
                node {
                  nh_id
                }
              }
            }
          }
        `,
      )
        .then(async result => {
          if (result.errors) {
            console.log(result.errors)
            reject(result.errors)
          }

          const getRawData = async id => {
            try {
              let isCacheFound = false
              let cacheRes
              // Read file from cache
              if (fs.existsSync('.tmp/crawler.json')) {
                const reader = fs.readFileSync('.tmp/crawler.json', 'utf8')
                const objects = JSON.parse(reader)

                _.each(objects, object => {
                  if (object.data.id === id && object.status === 'success') {
                    isCacheFound = true
                    cacheRes = object
                  }
                })
              }

              if (isCacheFound) {
                return cacheRes
              } else {
                const out = await axios.get(`https://nh-express-git-master.rayriffy.now.sh/api/gallery/${id}`)
                return {
                  status: 'success',
                  data: {
                    id: id,
                    raw: out.data,
                  },
                }
              }
            } catch (err) {
              console.log(`cannot process ${id} with code ${err.code}`)
              return {
                status: 'failure',
                data: {
                  id: id,
                },
              }
            }
          }

          const queue = new TaskQueue(Promise, MAX_SIMULTANEOUS_DOWNLOADS)

          const res = await Promise.all(
            result.data.allDataJson.edges.map(queue.wrap(async edge => await getRawData(edge.node.nh_id))),
          )

          return res
        })
        .then(result => {
          const pathPrefix = 'r/'
          const healthyResults = _.filter(result, o => o.status === 'success')

          // Create list page
          createPage({
            path: `listing`,
            component: path.resolve('./src/templates/listing.js'),
            context: {
              subtitle: `listing`,
              raw: healthyResults.reverse(),
            },
          })

          // Create each post
          _.each(healthyResults, node => {
            createPage({
              path: `${pathPrefix}${node.data.id}`,
              component: path.resolve('./src/templates/post.js'),
              context: {
                id: node.data.id,
                raw: node.data.raw,
              },
            })
          })

          // Process for each category
          const tagStack = [
            {prefix: 't', name: 'tag'},
            {prefix: 'p', name: 'parody'},
            {prefix: 'a', name: 'artist'},
            {prefix: 'g', name: 'groups'},
            {prefix: 'c', name: 'character'},
            {prefix: 'l', name: 'language'},
          ]

          const uniqueFilter = (nodes, type) => {
            const res = []
            _.each(healthyResults, node => {
              _.each(node.data.raw.tags, tag => {
                if (tag.type === type) {
                  if (_.isEmpty(_.filter(nodes, {id: tag.id}))) {
                    res.push(tag)
                  }
                }
              })
            })
            return res
          }

          const createSlugPages = (pathPrefix, nodes, name) => {
            _.each(nodes, tag => {
              const qualifiedResults = []
              _.each(healthyResults, node => {
                if (!_.isEmpty(_.filter(node.data.raw.tags, {id: tag.id}))) qualifiedResults.push(node)
              })
              createPage({
                path: `${pathPrefix}/${tag.id}`,
                component: path.resolve('./src/templates/listing.js'),
                context: {
                  subtitle: `${name}/${tag.name}`,
                  raw: qualifiedResults,
                },
              })
            })
          }

          _.each(tagStack, tag => {
            const nodes = uniqueFilter(healthyResults, tag.name)
            // Listing
            // All pages
            createSlugPages(tag.prefix, nodes, tag.name)
          })

          // Put into cache
          fs.writeFile(`.tmp/crawler.json`, JSON.stringify(healthyResults), function(err) {
            if (err) {
              console.log(err)
              reject(err)
            }
          })

          // Create own static api
          const apiPath = 'api'
          const chunks = _.chunk(healthyResults, 10)

          if (!fs.existsSync('./public/api')) {
            fs.mkdirSync('./public/api', function(err) {
              if (err) {
                console.log(err)
                reject(err)
              }
            })
          }
          if (!fs.existsSync('./public/api/list')) {
            fs.mkdirSync('./public/api/list', function(err) {
              if (err) {
                console.log(err)
                reject(err)
              }
            })
          }

          // API Status
          fs.writeFile(
            `public/${apiPath}/status.json`,
            JSON.stringify({
              status: 'success',
              code: 201,
              data: {
                time: Date.now(),
                list: {
                  length: chunks.length,
                },
              },
            }),
            function(err) {
              if (err) {
                console.log(err)
                reject(err)
              }
            },
          )

          // API Listing
          _.each(chunks, (chunk, i) => {
            let out = {
              status: 'success',
              code: 201,
              data: [],
            }
            _.each(chunk, node => {
              out.data.push(node.data.raw)
            })
            fs.writeFile(`public/${apiPath}/list/${i + 1}.json`, JSON.stringify(out), function(err) {
              if (err) {
                console.log(err)
                reject(err)
              }
            })
          })
        }),
    )
  })
}

exports.onCreateNode = ({node, actions, getNode}) => {
  const {createNodeField} = actions

  if (node.internal.type === `MarkdownRemark`) {
    const value = createFilePath({node, getNode})
    createNodeField({
      name: `slug`,
      node,
      value,
    })
  }
}
