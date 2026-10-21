/* PressTrace settings screen: Test connection button. */
( function () {
	'use strict';

	var config = window.presstraceAdmin;
	var button = document.getElementById( 'presstrace-test' );
	var result = document.getElementById( 'presstrace-test-result' );

	if ( ! config || ! button || ! result ) {
		return;
	}

	function show( message, ok ) {
		result.textContent = message;
		result.classList.toggle( 'is-success', ok === true );
		result.classList.toggle( 'is-error', ok === false );
	}

	button.addEventListener( 'click', function () {
		var body = new FormData();
		body.append( 'action', 'presstrace_test_connection' );
		body.append( 'nonce', config.nonce );

		button.disabled = true;
		button.setAttribute( 'aria-busy', 'true' );
		show( config.testing, null );

		fetch( config.ajaxUrl, { method: 'POST', body: body, credentials: 'same-origin' } )
			.then( function ( response ) {
				return response.json();
			} )
			.then( function ( json ) {
				var message = json && json.data && json.data.message ? json.data.message : config.failed;
				show( message, !! ( json && json.success ) );
			} )
			.catch( function () {
				show( config.failed, false );
			} )
			.then( function () {
				button.disabled = false;
				button.removeAttribute( 'aria-busy' );
			} );
	} );
}() );
