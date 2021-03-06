/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 Dan "Ducky" Little
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import React, {Component, PropTypes } from 'react';

import { connect } from 'react-redux';

import { removeQuery, createQuery, changeTool, renderedResultsForQuery} from '../actions/map';

import { startService, finishService } from '../actions/service';

import * as util from '../util';

import * as uuid from 'uuid';

import * as mapActions from '../actions/map';

import { getLayerFromPath } from '../actions/mapSource';

import { setUiHint } from '../actions/ui';

import Mark from 'markup-js';

import TextInput from './serviceInputs/text';
import SelectInput from './serviceInputs/select';

class ServiceManager extends Component {

    constructor() {
        super();
        this.services = {};

        this.finishedQueries = {};

        this.startQuery = this.startQuery.bind(this); 
        this.drawTool = this.drawTool.bind(this); 
        this.renderQuery = this.renderQuery.bind(this); 
        this.renderQueryResults = this.renderQueryResults.bind(this); 
        this.onServiceFieldChange = this.onServiceFieldChange.bind(this);

        this.state = {
            lastService: null,
            lastFeature: ''
        };

        this.fieldValues = {};
    }

    registerService(name, service) {

        this.services[name] = service;
    }

    /** Call the service with the relevant information
     *  and have it start a query.
     *
     */
    startQuery(service) {
        if(this.props.services[service]) {
            let service_def = this.props.services[service];
            let selection = this.props.store.getState().map.selectionFeatures[0];
            let fields = [];

            for(let name in this.fieldValues[service]) {
                fields.push({name: name, value: this.fieldValues[service][name]});
            }

            // check to see if the selection should stay 
            //  'alive' in the background.
            if(service_def.keepAlive !== true) {
                // shutdown the drawing on the layer.
                this.drawTool(null);
            }

            this.closeForm();
            this.props.services[service].query(selection, fields);
        } else {
            console.info('Failed to start query, service: ' + service + ' not found.');
        }

    }


    /** Renders the results for an individual query.
     *
     *  @param queryId the query's ID.
     *  @param query   The details of the query.
     *
     *  @returns a Hash appropriate for dnagerouslySetInnerHTML
     */
    renderQueryResults(queryId, query) {
        var html_contents = ''; 

        if(query.progress === 'finished' && this.props.services[query.service]) {
            let service = this.props.services[query.service];
            if(service.renderQueryResults) {
                service.renderQueryResults(queryId, query);
            }
            if(service.resultsAsHtml) {
                html_contents = service.resultsAsHtml(queryId, query);
            }
        }

        return {__html: html_contents};
    }

    removeQuery(queryId) {
        this.props.store.dispatch(removeQuery(queryId));
    }


    /** Render queries as they are coming in.
     *
     *  @param queryId
     *
     */
    renderQuery(queryId) {
        let query = this.props.queries[queryId];
        let service_title = this.props.services[query.service].resultsTitle;

        // this is a little ungangly but it will help those who
        //  forget to specify a results title.
        if(!service_title) {
            service_title = this.props.services[query.service].title + ' Results';
        }

        return (
            <div key={queryId}>
                <div className='results-header'>
                    { service_title }
                    <div className='results-tools'>
                        <i className='results-remove-icon' onClick={() => { this.removeQuery(queryId); }}></i>
                    </div>
                </div>
                <div className='results-query-id'>{ queryId }</div>
                <div dangerouslySetInnerHTML={this.renderQueryResults(queryId, query)}/>
            </div>
        );
    }


    /** Activate a drawing tool for selection,
     *  
     *  @param type Point, LineString, Polygon
     *
     */
    drawTool(type) {
        this.props.store.dispatch(changeTool(type));
    }

    closeForm() {
        this.props.store.dispatch(finishService());
    }

    shouldComponentUpdate(nextProps, nextState) {
        // when the drawing type changes this needs to 
        //  update the service 'page' because those elements
        //  are tied to the state of the interactionType.
        if(this.props.map.interactionType !== nextProps.map.interactionType) {
            return true;
        }

        for(let query_id of nextProps.queries.order) {
            if(!this.finishedQueries[query_id]) {
                let query = nextProps.queries[query_id];
                if(query && query.progress === 'finished') {
                    this.finishedQueries[query_id] = true;
                    let service = this.props.services[query.service];
                    if(service.renderQueryResults) {
                        service.renderQueryResults(query_id, query);
                    }
                }
            }
        }

        if(this.props.queries.service !== nextProps.queries.service) {
            return true;
        }

        // compare to the two sets of queries.
        const old_queries = this.props.queries;
        const new_queries = nextProps.queries;
        const old_keys = Object.keys(old_queries);
        const new_keys = Object.keys(new_queries);
        // quicky check
        if(old_keys.length !== new_keys.length) {
            return true;
        }

        // each array is the same length (see the test above)
        const len = old_keys.length;
        // the arrays are un-sorted so go through each and 
        //   if there is any missing keys, then kick back a true 
        for(let i = 0; i < len; i++) {
            let found = false;
            for(let j = 0; j < len && !found; j++) {
                if(new_keys[i] === old_keys[j]) {
                    let old_q = old_queries[old_keys[j]];
                    let new_q = new_queries[new_keys[j]];
                    // these are the same
                    if(old_q === null && new_q === null) {
                        found = true;
                    } else if(old_q === null || new_q === null) {
                        // these differ, this check prevents the
                        //  next check from happening and this should
                        //  actually keep found set to false.
                        found = false;
                    } else if(old_q.progress === new_q.progress) {
                        found = true;
                    }
                }
            }
            if(!found) { return true; }
        }

        // check to see if the selection features have changed.
        const old_features = this.props.map.selectionFeatures;
        const new_features = nextProps.map.selectionFeatures;
        if(old_features.length !== new_features.length) {
            return true;
        } else {
            // TODO: do a better list-against-list matching check.
            for(let i = 0, ii = old_features.length; i < ii; i++) {
                if(old_features[i].properties.id !== new_features[i].properties.id) {
                    return true;
                }
            }
        }



        return false;
    }

    /** Iterate through all of the queries and execute 
     *  the service's "runQuery" method if the query is
     *  in the appropriate state.
     *
     *  @param {Object} queries the Queries state.
     *
     */
    checkQueries(queries) {
        for(let query_id of queries.order) {
            let query = queries[query_id];
            let service = this.props.services[query.service];

            if(query && query.progress === 'new') {
                if(typeof(service.runQuery) == 'function') {
                    this.props.dispatch(mapActions.startQuery(query_id));
                    service.runQuery(query_id, query);
                }
            }
        }
    }

    componentWillUpdate(nextProps, nextState) {
        // anytime this updates, the user should really be seeing the service 
        //  tab.
        this.props.store.dispatch(setUiHint('service-manager'));

        // when the service changes, then clear out the previous 
        //  selection features
        if(this.state.lastService !== nextProps.queries.service 
           && nextProps.queries.service !== null) {
            let service_def = nextProps.services[nextProps.queries.service];
            // clear out the previous drawing tool when
            //  changing services.
            this.drawTool(service_def.tools.default);
            // 'rotate' the current servie to the next services.
            this.setState({lastService: nextProps.queries.service, lastFeature: ''});
            // clear out the previous selection feaures.
            this.props.store.dispatch(mapActions.clearSelectionFeatures());

            // clear out the previous field values.
            if(!this.fieldValues[nextProps.queries.service]) {
                this.fieldValues[nextProps.queries.service] = {};
            }
        } else {
            let service_name = this.state.lastService;
            let service_def = nextProps.services[service_name];

            // if this service has 'autoGo' and the feature is different
            //  than the last one, then execute the query.
            if(service_def.autoGo) { 
                let selection = nextProps.store.getState().map.selectionFeatures;
                if(selection.length > 0) {
                    // okay, there *is* a selection feature.
                    let fid = selection[0].properties.id;
                    if(nextState.lastFeature !== fid) {
                        this.setState({lastFeature: fid});
                        this.startQuery(service_name);
                    }
                }
            }
        }

        // check the queries and see if the services need to 
        //  dispatch anything
        this.checkQueries(nextProps.queries);
    }

    /** Render a drawing tool.
     *
     *  @param {String} gtype The "geometry" type: Point, Line Polygon.
     *
     */
    renderDrawTool(gtype) {
        let tool_class = 'draw-tool';
        if(this.props.map.interactionType === gtype) {
            tool_class += ' selected';
        }

        return (
            <div key={'draw-tool-' + gtype} className={tool_class} onClick={ () => { this.drawTool(gtype) } }>
                <i className="radio-icon"></i> Draw { gtype }
            </div>
        );
    }

    onServiceFieldChange(name, value) {
        this.fieldValues[this.props.queries.service][name] = value;
    }

    getServiceField(i, field) {
        switch(field.type) {
            case 'select':
                return (<SelectInput setValue={this.onServiceFieldChange} key={'field-' + i} field={field}/>);
            case 'text':
            default: 
                return (<TextInput setValue={this.onServiceFieldChange} key={'field-' + i} field={field}/>);
        }
    }

    render() {
        if(this.props.queries.service != null) {
            let service_name = this.props.queries.service;
            let service_def = this.props.services[service_name];

            const service_tools = [];
            for(let gtype of ['Point', 'Line', 'Polygon']) {
                if(service_def.tools[gtype]) {
                    service_tools.push(this.renderDrawTool(gtype));
                }
            }

            const service_fields = [];

            for(let i = 0, ii = service_def.fields.length; i < ii; i++) {
                const field = service_def.fields[i];
                service_fields.push(this.getServiceField(i, field));
            }

            return (
                <div className="service-manager">
                    <h3>{service_def.title}</h3>
                    { service_tools }
                    { service_fields }
                    <div className="tab-controls">
                        <button className="close-button" onClick={() => { this.closeForm() }}><i className="close-icon"></i> Close</button>
                        <button className="go-button" onClick={() => { this.startQuery(service_name) }}><i className="go-icon"></i> Go</button>
                    </div>
                </div>
            );
        } else {
            if(this.props.queries.order.length > 0) {
                return (
                    <div className="service-manager">
                        { this.props.queries.order.map(this.renderQuery) }
                    </div>
                );
            } else {
                return (
                    <div className="service-manager">
                        <div className="help">
                            Nothing available to view. Please click a service to start in the toolbar.
                        </div>
                    </div>
                );
            }
        }
    }

}


const mapToProps = function(store) {
    return {
        queries: store.query,
        map: store.map
    }
}
export default connect(mapToProps)(ServiceManager);
